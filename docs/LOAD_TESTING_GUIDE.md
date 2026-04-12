# TripSync Load Testing Guide — ALB + Auto Scaling

This guide sets up an Application Load Balancer (ALB) and Auto Scaling Group (ASG) **temporarily** for load testing, then tears everything down to avoid charges.

**Estimated cost**: ~$0.50 for 2-3 hours of testing  
**Estimated time**: ~30 minutes setup + testing + teardown

---

## Prerequisites

Before starting, confirm:

- [x] Backend is already running on EC2 and accessible
- [x] You can SSH into your EC2 instance
- [x] AWS CLI is configured on your local machine
- [x] Python 3 is installed locally (for Locust)

---

## All Variable Values (Reference)

Keep this table open — you'll need these throughout the guide. Values marked with **TBD** will be generated during setup.

| Variable | Value | Where from |
|----------|-------|------------|
| `EC2_SG_ID` | `sg-06c85806831dd5585` | Existing EC2 security group |
| `VPC_ID` | `vpc-0ae8d8d5139d6cc0b` | Existing VPC |
| `ACCOUNT_ID` | `486027077509` | AWS account |
| `SUBNET_1` | `subnet-0cd456f9d5744788b` | ap-southeast-1a |
| `SUBNET_2` | `subnet-00a714a44489283af` | ap-southeast-1b |
| `DATABASE_URL` | `postgresql+asyncpg://tripsync_admin:MyTripSync2026@tripsync-db.chiyeaew08uk.ap-southeast-1.rds.amazonaws.com:5432/tripsync` | RDS |
| `SECRET_KEY` | `LpenytLiCtwHeseZaO2+Wnr5YSqUlLypXLgmYL0+` | App secret |
| `GEMINI_API_KEY` | `AIzaSyAHBMj6Ibo_frrSGoCuKMRGYTAQ2OJqd2k` | Gemini |
| `FRONTEND_ORIGIN` | `https://d122amyq22pv4d.cloudfront.net` | CloudFront |
| `AMI_ID` | **TBD** — Step 1 output | Created in Step 1 |
| `ALB_SG_ID` | **TBD** — Step 3 output | Created in Step 3 |
| `ALB_ARN` | **TBD** — Step 3 output | Created in Step 3 |
| `ALB_DNS_NAME` | **TBD** — Step 3 output | Created in Step 3 |
| `TG_ARN` | **TBD** — Step 3 output | Created in Step 3 |
| `LISTENER_ARN` | **TBD** — Step 3 output | Created in Step 3 |

---

## Step 1: Create an AMI from Your EC2 Instance

An AMI (Amazon Machine Image) is a snapshot of your EC2 instance. The Auto Scaling Group will use it to launch identical copies of your backend server.

### 1.1 Get your instance ID

```bash
INSTANCE_ID=$(aws ec2 describe-instances \
  --filters "Name=tag:Name,Values=tripsync-backend" "Name=instance-state-name,Values=running" \
  --query 'Reservations[0].Instances[0].InstanceId' --output text)
echo "Instance ID: $INSTANCE_ID"
```

Expected output: `Instance ID: i-0472fc7b33ba3ed3e`

### 1.2 Create the AMI

```bash
AMI_ID=$(aws ec2 create-image \
  --instance-id $INSTANCE_ID \
  --name "tripsync-backend-ami-$(date +%Y%m%d)" \
  --description "TripSync backend with Docker" \
  --query 'ImageId' --output text)
echo "AMI_ID: $AMI_ID"
```

**Write down the `AMI_ID` output** (e.g. `ami-0abc1234def56789`). You will need it in Step 2.

### 1.3 Wait for AMI to be ready

AMI creation takes 2-5 minutes. Run this command repeatedly until it shows `available`:

```bash
aws ec2 describe-images --image-ids $AMI_ID --query 'Images[0].State' --output text
```

**Do NOT proceed until the output is `available`.**

---

## Step 2: Create a Launch Template

The launch template tells Auto Scaling how to launch each new instance — which AMI, instance type, security group, and startup script to use.

Replace `<AMI_ID>` below with the value from Step 1.2:

```bash
aws ec2 create-launch-template \
  --launch-template-name tripsync-lt \
  --version-description "v1" \
  --launch-template-data '{
    "ImageId": "<AMI_ID>",
    "InstanceType": "t2.micro",
    "KeyName": "tripsync-key",
    "SecurityGroupIds": ["sg-06c85806831dd5585"],
    "IamInstanceProfile": {"Name": "tripsync-ec2-profile"},
    "UserData": "'$(echo '#!/bin/bash
aws ecr get-login-password --region ap-southeast-1 | docker login --username AWS --password-stdin 486027077509.dkr.ecr.ap-southeast-1.amazonaws.com
docker pull 486027077509.dkr.ecr.ap-southeast-1.amazonaws.com/tripsync-backend:latest
docker run -d --name tripsync --restart unless-stopped -p 8000:8000 \
  -e DATABASE_URL="postgresql+asyncpg://tripsync_admin:MyTripSync2026@tripsync-db.chiyeaew08uk.ap-southeast-1.rds.amazonaws.com:5432/tripsync" \
  -e SECRET_KEY="LpenytLiCtwHeseZaO2+Wnr5YSqUlLypXLgmYL0+" \
  -e GEMINI_API_KEY="AIzaSyAHBMj6Ibo_frrSGoCuKMRGYTAQ2OJqd2k" \
  -e FRONTEND_ORIGIN="https://d122amyq22pv4d.cloudfront.net" \
  486027077509.dkr.ecr.ap-southeast-1.amazonaws.com/tripsync-backend:latest' | base64)'"
  }'
```

If successful, you'll see a JSON response with `"LaunchTemplateId"`. No need to save this value.

---

## Step 3: Create ALB (Application Load Balancer)

The ALB distributes incoming traffic across multiple backend instances.

### 3.1 Create a security group for the ALB

```bash
ALB_SG_ID=$(aws ec2 create-security-group \
  --group-name tripsync-alb-sg \
  --description "ALB security group" \
  --query 'GroupId' --output text)
echo "ALB_SG_ID: $ALB_SG_ID"
```

**Write down `ALB_SG_ID`** — you need it for cleanup.

### 3.2 Allow HTTP traffic into ALB (port 80)

```bash
aws ec2 authorize-security-group-ingress \
  --group-id $ALB_SG_ID \
  --protocol tcp --port 80 --cidr 0.0.0.0/0
```

### 3.3 Allow ALB to forward traffic to EC2 instances (port 8000)

```bash
aws ec2 authorize-security-group-ingress \
  --group-id sg-06c85806831dd5585 \
  --protocol tcp --port 8000 \
  --source-group $ALB_SG_ID
```

### 3.4 Create the ALB

```bash
ALB_OUTPUT=$(aws elbv2 create-load-balancer \
  --name tripsync-alb \
  --subnets subnet-0cd456f9d5744788b subnet-00a714a44489283af \
  --security-groups $ALB_SG_ID \
  --query 'LoadBalancers[0].[LoadBalancerArn,DNSName]' --output text)
ALB_ARN=$(echo "$ALB_OUTPUT" | awk '{print $1}')
ALB_DNS_NAME=$(echo "$ALB_OUTPUT" | awk '{print $2}')
echo "ALB_ARN: $ALB_ARN"
echo "ALB_DNS_NAME: $ALB_DNS_NAME"
```

**Write down both `ALB_ARN` and `ALB_DNS_NAME`** — you need them later.

### 3.5 Create a Target Group

The target group tells the ALB where to send traffic and how to check if instances are healthy.

```bash
TG_ARN=$(aws elbv2 create-target-group \
  --name tripsync-tg \
  --protocol HTTP \
  --port 8000 \
  --vpc-id vpc-0ae8d8d5139d6cc0b \
  --health-check-path /docs \
  --health-check-interval-seconds 30 \
  --query 'TargetGroups[0].TargetGroupArn' --output text)
echo "TG_ARN: $TG_ARN"
```

**Write down `TG_ARN`** — you need it for cleanup.

### 3.6 Create a Listener

The listener connects the ALB to the target group — when traffic arrives at ALB port 80, forward it to the target group.

```bash
LISTENER_ARN=$(aws elbv2 create-listener \
  --load-balancer-arn $ALB_ARN \
  --protocol HTTP \
  --port 80 \
  --default-actions Type=forward,TargetGroupArn=$TG_ARN \
  --query 'Listeners[0].ListenerArn' --output text)
echo "LISTENER_ARN: $LISTENER_ARN"
```

**Write down `LISTENER_ARN`** — you need it for cleanup.

---

## Step 4: Create Auto Scaling Group

The ASG automatically launches/terminates instances based on CPU usage.

### 4.1 Create the ASG

```bash
aws autoscaling create-auto-scaling-group \
  --auto-scaling-group-name tripsync-asg \
  --launch-template LaunchTemplateName=tripsync-lt,Version='$Latest' \
  --min-size 1 \
  --max-size 4 \
  --desired-capacity 2 \
  --target-group-arns $TG_ARN \
  --availability-zones ap-southeast-1a ap-southeast-1b
```

No output means success.

### 4.2 Add a scaling policy

This tells ASG to add instances when average CPU exceeds 70%:

```bash
aws autoscaling put-scaling-policy \
  --auto-scaling-group-name tripsync-asg \
  --policy-name tripsync-cpu-scaling \
  --policy-type TargetTrackingScaling \
  --target-tracking-configuration '{
    "PredefinedMetricSpecification": {
      "PredefinedMetricType": "ASGAverageCPUUtilization"
    },
    "TargetValue": 70.0
  }'
```

### 4.3 Wait for instances to become healthy

ASG instances take 2-3 minutes to launch, pull Docker images, and start. Check target health:

```bash
aws elbv2 describe-target-health \
  --target-group-arn $TG_ARN \
  --query 'TargetHealthDescriptions[*].[Target.Id,TargetHealth.State]' \
  --output table
```

Run this command every 30 seconds. **Do NOT proceed until at least 1 target shows `healthy`.**

Example of ready output:
```
-------------------------------
|   DescribeTargetHealth      |
+------------------+----------+
|  i-0abc12345def  |  healthy |
|  i-0xyz98765ghi  |  healthy |
+------------------+----------+
```

You can also verify ASG instances are running:

```bash
aws autoscaling describe-auto-scaling-groups \
  --auto-scaling-group-names tripsync-asg \
  --query 'AutoScalingGroups[0].Instances[*].[InstanceId,LifecycleState,HealthStatus]' \
  --output table
```

---

## Step 5: Run Load Test with Locust

### 5.1 Install Locust

On your **local machine** (not EC2):

```bash
pip install locust
```

### 5.2 Create the test file

Create a directory and file `loadtest/locustfile.py`:

```bash
mkdir -p loadtest
```

Then create `loadtest/locustfile.py` with the following content:

```python
from locust import HttpUser, task, between
import random
import string


class TripSyncUser(HttpUser):
    wait_time = between(1, 3)

    def on_start(self):
        """Register and login to get a JWT token."""
        rand = ''.join(random.choices(string.ascii_lowercase, k=8))
        self.email = f"loadtest_{rand}@test.com"
        self.password = "Test1234!"

        # Register
        resp = self.client.post("/v1/auth/register", json={
            "email": self.email,
            "username": f"user_{rand}",
            "password": self.password,
        })
        data = resp.json()
        self.token = data["access_token"]
        self.headers = {"Authorization": f"Bearer {self.token}"}

        # Create an itinerary
        resp = self.client.post(
            "/v1/itineraries",
            json={"title": f"Trip {rand}"},
            headers=self.headers,
        )
        self.itinerary_id = resp.json()["id"]

        # Add a day
        resp = self.client.post(
            f"/v1/itineraries/{self.itinerary_id}/days",
            json={"date": "2026-06-01", "day_order": 0},
            headers=self.headers,
        )
        self.day_id = resp.json()["id"]

        # Add an item
        resp = self.client.post(
            f"/v1/itineraries/{self.itinerary_id}/days/{self.day_id}/items",
            json={"spot_name": "Test Spot"},
            headers=self.headers,
        )
        self.item_id = resp.json()["id"]

    @task(5)
    def get_itinerary(self):
        """Read itinerary (most common operation)."""
        self.client.get(
            f"/v1/itineraries/{self.itinerary_id}",
            headers=self.headers,
        )

    @task(3)
    def list_itineraries(self):
        """List all user itineraries."""
        self.client.get("/v1/itineraries", headers=self.headers)

    @task(2)
    def edit_item(self):
        """Collaborative edit — field-level patch."""
        self.client.patch(
            f"/v1/itineraries/{self.itinerary_id}/items/{self.item_id}",
            json={
                "changes": [{
                    "field": "spot_name",
                    "value": f"Spot {random.randint(1, 10000)}",
                    "based_on_updated_at": "2000-01-01T00:00:00",
                }],
                "save_version": True,
            },
            headers=self.headers,
        )

    @task(1)
    def list_versions(self):
        """List version history."""
        self.client.get(
            f"/v1/itineraries/{self.itinerary_id}/versions",
            headers=self.headers,
        )
```

### 5.3 Run Locust

Replace `<ALB_DNS_NAME>` with the value you wrote down from Step 3.4:

```bash
cd loadtest
locust -f locustfile.py --host http://<ALB_DNS_NAME>
```

### 5.4 Start the test in browser

Open http://localhost:8089 in your browser. Configure:

| Setting | Value |
|---------|-------|
| Number of users | 100 |
| Spawn rate | 10 |

Click **Start swarming**.

### 5.5 Monitor and collect results

Let the test run for **5 minutes**, then click **Stop**.

**Key metrics to check:**

| Metric | Good | Bad |
|--------|------|-----|
| Avg response time (reads) | < 200ms | > 500ms |
| Avg response time (writes) | < 500ms | > 1000ms |
| Failure rate | < 1% | > 5% |
| Requests/sec | Higher is better | — |
| 95th percentile | < 500ms | > 2000ms |

**Take screenshots** of the Locust dashboard — these are useful for your report.

You can also monitor Auto Scaling activity while the test runs:

```bash
aws autoscaling describe-scaling-activities \
  --auto-scaling-group-name tripsync-asg \
  --query 'Activities[*].[StartTime,StatusCode,Description]' \
  --output table
```

When done testing, press `Ctrl+C` in the terminal to stop Locust, then proceed to Step 6.

---

## Step 6: Tear Down — IMPORTANT

**Do this immediately after testing to avoid charges.** ALB charges ~$0.02/hour even when idle.

Run the following commands **in order**. Replace any `<PLACEHOLDER>` with the values you wrote down earlier. If you used shell variables (`$ALB_ARN`, etc.) and your terminal session is still open, the variables should still work.

### 6.1 Delete the Auto Scaling Group

```bash
aws autoscaling delete-auto-scaling-group \
  --auto-scaling-group-name tripsync-asg \
  --force-delete
```

This terminates all ASG-launched instances. Takes ~1 minute.

### 6.2 Delete the Listener

```bash
aws elbv2 delete-listener --listener-arn $LISTENER_ARN
```

### 6.3 Delete the Target Group

```bash
aws elbv2 delete-target-group --target-group-arn $TG_ARN
```

### 6.4 Delete the ALB

```bash
aws elbv2 delete-load-balancer --load-balancer-arn $ALB_ARN
```

### 6.5 Wait, then delete the ALB security group

The ALB takes ~1 minute to fully delete. Wait, then:

```bash
aws ec2 delete-security-group --group-id $ALB_SG_ID
```

If you get an error like `DependencyViolation`, wait another minute and retry.

### 6.6 Delete the Launch Template

```bash
aws ec2 delete-launch-template --launch-template-name tripsync-lt
```

### 6.7 Deregister the AMI

```bash
aws ec2 deregister-image --image-id $AMI_ID
```

### 6.8 Remove the ALB→EC2 security group rule

This removes the rule we added in Step 3.3 so your EC2 security group stays clean:

```bash
aws ec2 revoke-security-group-ingress \
  --group-id sg-06c85806831dd5585 \
  --protocol tcp --port 8000 \
  --source-group $ALB_SG_ID
```

> Note: If you already deleted the ALB security group in 6.5, this command may fail — that's OK, the rule is automatically removed when the referenced SG is deleted.

### 6.9 Verify cleanup

```bash
echo "=== ASG ==="
aws autoscaling describe-auto-scaling-groups --auto-scaling-group-names tripsync-asg \
  --query 'AutoScalingGroups' --output text

echo "=== ALB ==="
aws elbv2 describe-load-balancers --names tripsync-alb 2>&1

echo "=== Launch Template ==="
aws ec2 describe-launch-templates --launch-template-names tripsync-lt 2>&1
```

All three should return empty results or `not found` errors. If so, cleanup is complete.

**Your original single EC2 instance (free tier) is unaffected and still running.**

---

## Important Notes

### Before testing
- Make sure your **RDS instance** can handle the load — `db.t3.micro` has limited connections (~60). If you see database connection errors during the test, the bottleneck is RDS, not your app.
- The test creates **many user accounts** in your database. These are real records with `loadtest_*` emails.

### During testing
- The **first 1-2 minutes** will have higher error rates as ASG instances are still initializing. This is normal.
- Watch for `on_start` failures — if registration fails, that simulated user's entire session fails. A few are OK, many indicate a real problem.
- You can open a **second terminal** and watch ASG scaling in real time:
  ```bash
  watch -n 10 "aws autoscaling describe-auto-scaling-groups \
    --auto-scaling-group-names tripsync-asg \
    --query 'AutoScalingGroups[0].[DesiredCapacity,Instances[*].InstanceId]' \
    --output text"
  ```

### After testing
- **Tear down immediately** (Step 6). Set a timer if needed. Every hour costs ~$0.02 for ALB + ~$0.01 per extra EC2 instance.
- If you close your terminal and lose the shell variables, you can look up the values:
  ```bash
  # Find ALB ARN
  aws elbv2 describe-load-balancers --names tripsync-alb \
    --query 'LoadBalancers[0].LoadBalancerArn' --output text

  # Find Target Group ARN
  aws elbv2 describe-target-groups --names tripsync-tg \
    --query 'TargetGroups[0].TargetGroupArn' --output text

  # Find Listener ARN
  ALB_ARN=$(aws elbv2 describe-load-balancers --names tripsync-alb \
    --query 'LoadBalancers[0].LoadBalancerArn' --output text)
  aws elbv2 describe-listeners --load-balancer-arn $ALB_ARN \
    --query 'Listeners[0].ListenerArn' --output text

  # Find ALB Security Group
  aws ec2 describe-security-groups --group-names tripsync-alb-sg \
    --query 'SecurityGroups[0].GroupId' --output text

  # Find AMI
  aws ec2 describe-images --owners self --filters "Name=name,Values=tripsync-backend-ami-*" \
    --query 'Images[0].ImageId' --output text
  ```

### Clean up test data (optional)
If you want to remove the load test accounts from your database, SSH into EC2 and run:
```bash
ssh -i tripsync-key.pem ec2-user@18.142.57.92
docker exec tripsync python -c "
import asyncio, asyncpg
async def clean():
    conn = await asyncpg.connect('postgresql://tripsync_admin:MyTripSync2026@tripsync-db.chiyeaew08uk.ap-southeast-1.rds.amazonaws.com:5432/tripsync')
    count = await conn.execute(\"DELETE FROM users WHERE email LIKE 'loadtest_%@test.com'\")
    print(f'Deleted: {count}')
    await conn.close()
asyncio.run(clean())
"
```

---

## Quick Reference: Full Teardown Checklist

```
[ ] Step 6.1 — Delete Auto Scaling Group (tripsync-asg)
[ ] Step 6.2 — Delete Listener
[ ] Step 6.3 — Delete Target Group (tripsync-tg)
[ ] Step 6.4 — Delete ALB (tripsync-alb)
[ ] Step 6.5 — Delete ALB Security Group (tripsync-alb-sg)
[ ] Step 6.6 — Delete Launch Template (tripsync-lt)
[ ] Step 6.7 — Deregister AMI
[ ] Step 6.8 — Remove ALB→EC2 security group rule
[ ] Step 6.9 — Verify all resources are gone
```
