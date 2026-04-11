# TripSync AWS Deployment Guide

## Architecture Overview

```
                         Internet
                            │
              ┌─────────────┼─────────────┐
              ▼                           ▼
        CloudFront (CDN)            ALB (optional, for load testing)
              │                      ╱    │    ╲
        S3 Bucket               EC2    EC2    EC2
      (React static)         (Auto Scaling Group, t2.micro)
                                 │Docker: FastAPI + Uvicorn│
                                         │
                                   RDS PostgreSQL
                                   (db.t3.micro)
```

**Free Tier components:**
- **S3** — 5 GB storage, 20K GET / 2K PUT per month
- **CloudFront** — 1 TB transfer / 10M requests per month (first year)
- **EC2 t2.micro** — 750 hours/month (1 vCPU, 1 GB RAM)
- **RDS db.t3.micro** — 750 hours/month, 20 GB storage

**Pay-as-you-go (for load testing only):**
- **ALB** — ~$0.02/hour + ~$0.008 per LCU-hour
- **Extra EC2 instances** — ~$0.012/hour per t2.micro (beyond free tier)

---

## Prerequisites

1. **AWS Account** with free tier eligibility
2. **AWS CLI v2** installed and configured
3. **Docker** installed locally
4. **Node.js 18+** and **Python 3.12**

```bash
# Install AWS CLI (macOS)
brew install awscli
```

### Create an IAM User (Do NOT use root account access keys)

> **Important:** Never use your AWS root account for daily operations or generate access keys for it. If your root key leaks, your entire account is compromised with no permission boundaries. Create a dedicated IAM user instead.

1. Log in to the AWS Console with your root account
2. Go to **IAM → Users → Create user**
3. User name: `tripsync-deployer`
4. Attach the following **managed policies** (for simplicity in a course project):
   - `AmazonEC2FullAccess`
   - `AmazonRDS_FullAccess`
   - `AmazonS3FullAccess`
   - `CloudFrontFullAccess`
   - `AmazonEC2ContainerRegistryFullAccess`
   - `IAMFullAccess` (needed to create EC2 instance profile)
5. Create the user, then go to **Security credentials → Create access key → CLI**
6. Save the Access Key ID and Secret Access Key

```bash
# Configure AWS CLI with the IAM user credentials (NOT root account)
aws configure
# AWS Access Key ID: <IAM-user-key>
# AWS Secret Access Key: <IAM-user-secret>
# Default region: ap-southeast-1
# Default output format: json
```

---

## Step 1: Create RDS PostgreSQL Database

### 1.1 Create a Security Group for RDS

```bash
# Create VPC security group for RDS
aws ec2 create-security-group \
  --group-name tripsync-rds-sg \
  --description "Security group for TripSync RDS" \
  --query 'GroupId' --output text
# Save the output as RDS_SG_ID

# Allow PostgreSQL access from EC2 (we'll update the source SG later)
aws ec2 authorize-security-group-ingress \
  --group-id <RDS_SG_ID> \
  --protocol tcp \
  --port 5432 \
  --source-group <EC2_SG_ID>
```

### 1.2 Create the RDS Instance

```bash
aws rds create-db-instance \
  --db-instance-identifier tripsync-db \
  --db-instance-class db.t3.micro \
  --engine postgres \
  --engine-version 15.7 \
  --master-username tripsync_admin \
  --master-user-password '<STRONG_PASSWORD>' \
  --allocated-storage 20 \
  --storage-type gp2 \
  --no-multi-az \
  --no-publicly-accessible \
  --vpc-security-group-ids <RDS_SG_ID> \
  --db-name tripsync \
  --backup-retention-period 1
```

> **Free Tier note:** `db.t3.micro`, single-AZ, 20 GB gp2 — all within free tier.

### 1.3 Get the RDS Endpoint

```bash
aws rds describe-db-instances \
  --db-instance-identifier tripsync-db \
  --query 'DBInstances[0].Endpoint.Address' --output text
# Example output: tripsync-db.xxxxxxxxxxxx.ap-southeast-1.rds.amazonaws.com
```

Your `DATABASE_URL` will be:
```
postgresql+asyncpg://tripsync_admin:<PASSWORD>@<RDS_ENDPOINT>:5432/tripsync
```

---

## Step 2: Dockerize the Backend

### 2.1 Create Dockerfile

Create `backend/Dockerfile`:

```dockerfile
FROM python:3.12-slim

# WeasyPrint system dependencies
RUN apt-get update && \
    apt-get install -y --no-install-recommends \
    libpango-1.0-0 libpangocairo-1.0-0 libgdk-pixbuf2.0-0 \
    libffi-dev libcairo2 && \
    rm -rf /var/lib/apt/lists/*

WORKDIR /app

COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

COPY . .

EXPOSE 8000

CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8000"]
```

### 2.2 Create .dockerignore

Create `backend/.dockerignore`:

```
__pycache__
*.pyc
.env
.pytest_cache
tests/
alembic/versions/__pycache__
```

### 2.3 Build and Test Locally

```bash
cd backend

# Build the image
docker build -t tripsync-backend .

# Run locally (test)
docker run --rm -p 8000:8000 \
  -e DATABASE_URL="postgresql+asyncpg://postgres@host.docker.internal:5432/tripsync" \
  -e SECRET_KEY="test-secret-key-32-chars-long!!" \
  tripsync-backend
```

---

## Step 3: Set Up EC2 Instance

### 3.1 Create Security Group for EC2

```bash
aws ec2 create-security-group \
  --group-name tripsync-ec2-sg \
  --description "Security group for TripSync EC2" \
  --query 'GroupId' --output text
# Save as EC2_SG_ID

# Allow SSH (restrict to your IP for better security)
# Replace <YOUR_IP> with your public IP, or use 0.0.0.0/0 if your IP changes often
aws ec2 authorize-security-group-ingress \
  --group-id <EC2_SG_ID> \
  --protocol tcp --port 22 --cidr <YOUR_IP>/32

# Allow HTTP (backend API)
aws ec2 authorize-security-group-ingress \
  --group-id <EC2_SG_ID> \
  --protocol tcp --port 8000 --cidr 0.0.0.0/0

# Now update RDS SG to allow traffic from EC2 SG
aws ec2 authorize-security-group-ingress \
  --group-id <RDS_SG_ID> \
  --protocol tcp --port 5432 \
  --source-group <EC2_SG_ID>
```

### 3.2 Create Key Pair

```bash
aws ec2 create-key-pair \
  --key-name tripsync-key \
  --query 'KeyMaterial' --output text > tripsync-key.pem

chmod 400 tripsync-key.pem
```

### 3.3 Launch EC2 Instance

```bash
# Find the latest Amazon Linux 2023 AMI (don't hardcode — AMI IDs expire over time)
AMI_ID=$(aws ec2 describe-images \
  --owners amazon \
  --filters "Name=name,Values=al2023-ami-2023*-x86_64" "Name=state,Values=available" \
  --query 'sort_by(Images,&CreationDate)[-1].ImageId' \
  --output text)
echo "Using AMI: $AMI_ID"

aws ec2 run-instances \
  --image-id $AMI_ID \
  --instance-type t2.micro \
  --key-name tripsync-key \
  --security-group-ids <EC2_SG_ID> \
  --iam-instance-profile Name=tripsync-ec2-profile \
  --tag-specifications 'ResourceType=instance,Tags=[{Key=Name,Value=tripsync-backend}]' \
  --user-data '#!/bin/bash
yum update -y
yum install -y docker
systemctl start docker
systemctl enable docker
usermod -aG docker ec2-user' \
  --query 'Instances[0].InstanceId' --output text
```

> **Note:** `--user-data` automatically installs and starts Docker on first boot.
> The `--iam-instance-profile` gives EC2 permission to pull images from ECR (see Step 3.4a).

### 3.4a Create IAM Role for EC2 (ECR Access)

The EC2 instance needs permission to pull Docker images from ECR. Without this, `aws ecr get-login-password` on the instance will fail.

```bash
# Create IAM Role for EC2
aws iam create-role \
  --role-name tripsync-ec2-role \
  --assume-role-policy-document '{
    "Version":"2012-10-17",
    "Statement":[{
      "Effect":"Allow",
      "Principal":{"Service":"ec2.amazonaws.com"},
      "Action":"sts:AssumeRole"
    }]
  }'

# Attach ECR read-only policy
aws iam attach-role-policy \
  --role-name tripsync-ec2-role \
  --policy-arn arn:aws:iam::aws:policy/AmazonEC2ContainerRegistryReadOnly

# Create Instance Profile and associate the role
aws iam create-instance-profile \
  --instance-profile-name tripsync-ec2-profile

aws iam add-role-to-instance-profile \
  --instance-profile-name tripsync-ec2-profile \
  --role-name tripsync-ec2-role
```

> **Note:** Run this **before** launching the EC2 instance (Step 3.3), since the launch command references `--iam-instance-profile`.

### 3.4 Get Public IP

```bash
aws ec2 describe-instances \
  --filters "Name=tag:Name,Values=tripsync-backend" "Name=instance-state-name,Values=running" \
  --query 'Reservations[0].Instances[0].PublicIpAddress' --output text
# Save as EC2_PUBLIC_IP
```

### 3.5 SSH and Deploy

```bash
ssh -i tripsync-key.pem ec2-user@<EC2_PUBLIC_IP>
```

On the EC2 instance:

```bash
# Verify Docker is running
docker ps

# Login to ECR (see Step 3.6) or transfer image directly
```

### 3.6 Use ECR (Elastic Container Registry) for Docker Images

ECR free tier: 500 MB storage/month for private repos (first year).

```bash
# Create ECR repository (run locally)
aws ecr create-repository --repository-name tripsync-backend \
  --query 'repository.repositoryUri' --output text
# Example: 123456789012.dkr.ecr.ap-southeast-1.amazonaws.com/tripsync-backend

# Login to ECR
aws ecr get-login-password --region ap-southeast-1 | \
  docker login --username AWS --password-stdin \
  123456789012.dkr.ecr.ap-southeast-1.amazonaws.com

# Tag and push image
docker tag tripsync-backend:latest \
  123456789012.dkr.ecr.ap-southeast-1.amazonaws.com/tripsync-backend:latest
docker push \
  123456789012.dkr.ecr.ap-southeast-1.amazonaws.com/tripsync-backend:latest
```

On EC2:

```bash
# Login to ECR
aws ecr get-login-password --region ap-southeast-1 | \
  docker login --username AWS --password-stdin \
  123456789012.dkr.ecr.ap-southeast-1.amazonaws.com

# Pull and run
docker pull 123456789012.dkr.ecr.ap-southeast-1.amazonaws.com/tripsync-backend:latest

docker run -d --name tripsync \
  --restart unless-stopped \
  -p 8000:8000 \
  -e DATABASE_URL="postgresql+asyncpg://tripsync_admin:<PASSWORD>@<RDS_ENDPOINT>:5432/tripsync" \
  -e SECRET_KEY="<YOUR_SECRET_KEY>" \
  -e GEMINI_API_KEY="<YOUR_GEMINI_KEY>" \
  -e FRONTEND_ORIGIN="https://<CLOUDFRONT_DOMAIN>" \
  123456789012.dkr.ecr.ap-southeast-1.amazonaws.com/tripsync-backend:latest
```

### 3.7 Run Database Migrations

```bash
# On EC2, run migrations inside the container
docker exec tripsync alembic upgrade head
```

---

## Step 4: Deploy Frontend to S3 + CloudFront

### 4.1 Build the Frontend

The frontend uses a relative `/v1` base URL (see `frontend/src/api/client.ts`). In production, we need to point it to the backend's absolute URL.

Create `frontend/.env.production`:

```bash
VITE_API_BASE_URL=http://<EC2_PUBLIC_IP>:8000/v1
VITE_GOOGLE_MAPS_KEY=<YOUR_KEY>   # optional
```

Then update `frontend/src/api/client.ts` to use the env variable:

```typescript
const api = axios.create({
  baseURL: import.meta.env.VITE_API_BASE_URL || '/v1',
  headers: { 'Content-Type': 'application/json' },
})
```

Build the production bundle:

```bash
cd frontend
npm run build
# Output: frontend/dist/
```

### 4.2 Create S3 Bucket

```bash
# Create bucket
aws s3 mb s3://tripsync-frontend-<ACCOUNT_ID>

# Enable static website hosting
aws s3 website s3://tripsync-frontend-<ACCOUNT_ID> \
  --index-document index.html \
  --error-document index.html
```

### 4.3 Upload Build Files

```bash
# Sync the build output to S3
aws s3 sync frontend/dist/ s3://tripsync-frontend-<ACCOUNT_ID>/ \
  --delete \
  --cache-control "public, max-age=31536000" \
  --exclude "index.html"

# Upload index.html with no-cache (so deployments take effect immediately)
aws s3 cp frontend/dist/index.html s3://tripsync-frontend-<ACCOUNT_ID>/index.html \
  --cache-control "no-cache, no-store, must-revalidate"
```

### 4.4 Create CloudFront Distribution

Create `cloudfront-config.json`:

```json
{
  "CallerReference": "tripsync-$(date +%s)",
  "Origins": {
    "Quantity": 1,
    "Items": [
      {
        "Id": "S3-tripsync-frontend",
        "DomainName": "tripsync-frontend-<ACCOUNT_ID>.s3.ap-southeast-1.amazonaws.com",
        "S3OriginConfig": {
          "OriginAccessIdentity": ""
        }
      }
    ]
  },
  "DefaultCacheBehavior": {
    "TargetOriginId": "S3-tripsync-frontend",
    "ViewerProtocolPolicy": "redirect-to-https",
    "AllowedMethods": {
      "Quantity": 2,
      "Items": ["GET", "HEAD"]
    },
    "ForwardedValues": {
      "QueryString": false,
      "Cookies": { "Forward": "none" }
    },
    "MinTTL": 0,
    "DefaultTTL": 86400,
    "MaxTTL": 31536000,
    "Compress": true
  },
  "CustomErrorResponses": {
    "Quantity": 1,
    "Items": [
      {
        "ErrorCode": 404,
        "ResponsePagePath": "/index.html",
        "ResponseCode": "200",
        "ErrorCachingMinTTL": 0
      }
    ]
  },
  "DefaultRootObject": "index.html",
  "Enabled": true,
  "Comment": "TripSync Frontend"
}
```

```bash
aws cloudfront create-distribution \
  --distribution-config file://cloudfront-config.json \
  --query 'Distribution.DomainName' --output text
# Output: d1234abcdef.cloudfront.net
```

### 4.5 Update S3 Bucket Policy

Allow CloudFront to read from S3:

```bash
aws s3api put-bucket-policy --bucket tripsync-frontend-<ACCOUNT_ID> --policy '{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Sid": "PublicRead",
      "Effect": "Allow",
      "Principal": "*",
      "Action": "s3:GetObject",
      "Resource": "arn:aws:s3:::tripsync-frontend-<ACCOUNT_ID>/*"
    }
  ]
}'
```

### 4.6 Update Backend CORS

After you get the CloudFront domain, update `backend/app/main.py`:

```python
app.add_middleware(
    CORSMiddleware,
    allow_origins=[
        "http://localhost:3000",
        "https://d1234abcdef.cloudfront.net",  # your CloudFront domain
    ],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)
```

Or better, use the `FRONTEND_ORIGIN` env variable:

```python
from app.core.config import settings

app.add_middleware(
    CORSMiddleware,
    allow_origins=[
        "http://localhost:3000",
        settings.FRONTEND_ORIGIN,
    ],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)
```

Then set `FRONTEND_ORIGIN=https://d1234abcdef.cloudfront.net` in the Docker env.

---

## Step 5: GitHub Actions CI/CD

Create `.github/workflows/deploy.yml`:

```yaml
name: Deploy TripSync

on:
  push:
    branches: [main]

env:
  AWS_REGION: ap-southeast-1
  ECR_REPOSITORY: tripsync-backend
  S3_BUCKET: tripsync-frontend-${{ secrets.AWS_ACCOUNT_ID }}

jobs:
  # ─── Backend: Build, push to ECR, deploy to EC2 ───
  deploy-backend:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4

      - name: Configure AWS credentials
        uses: aws-actions/configure-aws-credentials@v4
        with:
          aws-access-key-id: ${{ secrets.AWS_ACCESS_KEY_ID }}
          aws-secret-access-key: ${{ secrets.AWS_SECRET_ACCESS_KEY }}
          aws-region: ${{ env.AWS_REGION }}

      - name: Login to Amazon ECR
        id: login-ecr
        uses: aws-actions/amazon-ecr-login@v2

      - name: Build and push Docker image
        working-directory: backend
        run: |
          IMAGE_URI=${{ steps.login-ecr.outputs.registry }}/${{ env.ECR_REPOSITORY }}:${{ github.sha }}
          IMAGE_LATEST=${{ steps.login-ecr.outputs.registry }}/${{ env.ECR_REPOSITORY }}:latest
          docker build -t $IMAGE_URI -t $IMAGE_LATEST .
          docker push $IMAGE_URI
          docker push $IMAGE_LATEST

      - name: Deploy to EC2
        uses: appleboy/ssh-action@v1
        with:
          host: ${{ secrets.EC2_HOST }}
          username: ec2-user
          key: ${{ secrets.EC2_SSH_KEY }}
          script: |
            # Login to ECR
            aws ecr get-login-password --region ${{ env.AWS_REGION }} | \
              docker login --username AWS --password-stdin \
              ${{ secrets.AWS_ACCOUNT_ID }}.dkr.ecr.${{ env.AWS_REGION }}.amazonaws.com

            # Pull latest image
            docker pull ${{ secrets.AWS_ACCOUNT_ID }}.dkr.ecr.${{ env.AWS_REGION }}.amazonaws.com/${{ env.ECR_REPOSITORY }}:latest

            # Stop old container
            docker stop tripsync || true
            docker rm tripsync || true

            # Run new container
            docker run -d --name tripsync \
              --restart unless-stopped \
              -p 8000:8000 \
              -e DATABASE_URL="${{ secrets.DATABASE_URL }}" \
              -e SECRET_KEY="${{ secrets.SECRET_KEY }}" \
              -e GEMINI_API_KEY="${{ secrets.GEMINI_API_KEY }}" \
              -e FRONTEND_ORIGIN="${{ secrets.FRONTEND_ORIGIN }}" \
              ${{ secrets.AWS_ACCOUNT_ID }}.dkr.ecr.${{ env.AWS_REGION }}.amazonaws.com/${{ env.ECR_REPOSITORY }}:latest

            # Run migrations
            docker exec tripsync alembic upgrade head

            # Clean up old images
            docker image prune -f

  # ─── Frontend: Build and deploy to S3 + CloudFront ───
  deploy-frontend:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4

      - uses: actions/setup-node@v4
        with:
          node-version: 18
          cache: npm
          cache-dependency-path: frontend/package-lock.json

      - name: Install and build
        working-directory: frontend
        run: |
          npm ci
          npm run build
        env:
          VITE_API_BASE_URL: ${{ secrets.VITE_API_BASE_URL }}
          VITE_GOOGLE_MAPS_KEY: ${{ secrets.VITE_GOOGLE_MAPS_KEY }}

      - name: Configure AWS credentials
        uses: aws-actions/configure-aws-credentials@v4
        with:
          aws-access-key-id: ${{ secrets.AWS_ACCESS_KEY_ID }}
          aws-secret-access-key: ${{ secrets.AWS_SECRET_ACCESS_KEY }}
          aws-region: ${{ env.AWS_REGION }}

      - name: Deploy to S3
        working-directory: frontend
        run: |
          # Upload hashed assets with long cache
          aws s3 sync dist/ s3://${{ env.S3_BUCKET }}/ \
            --delete \
            --cache-control "public, max-age=31536000" \
            --exclude "index.html"

          # Upload index.html with no-cache
          aws s3 cp dist/index.html s3://${{ env.S3_BUCKET }}/index.html \
            --cache-control "no-cache, no-store, must-revalidate"

      - name: Invalidate CloudFront cache
        run: |
          aws cloudfront create-invalidation \
            --distribution-id ${{ secrets.CLOUDFRONT_DISTRIBUTION_ID }} \
            --paths "/index.html"
```

### Required GitHub Secrets

Go to your repo → Settings → Secrets and variables → Actions, and add:

| Secret | Value |
|--------|-------|
| `AWS_ACCESS_KEY_ID` | IAM user access key (**not** root account key) |
| `AWS_SECRET_ACCESS_KEY` | IAM user secret key (**not** root account key) |
| `AWS_ACCOUNT_ID` | 12-digit AWS account ID |
| `EC2_HOST` | EC2 public IP or Elastic IP |
| `EC2_SSH_KEY` | Content of `tripsync-key.pem` |
| `DATABASE_URL` | `postgresql+asyncpg://tripsync_admin:...@<RDS_ENDPOINT>:5432/tripsync` |
| `SECRET_KEY` | Your JWT signing key (32+ chars) |
| `GEMINI_API_KEY` | Google Gemini API key (optional) |
| `FRONTEND_ORIGIN` | `https://d1234abcdef.cloudfront.net` |
| `VITE_API_BASE_URL` | `http://<EC2_IP>:8000/v1` |
| `VITE_GOOGLE_MAPS_KEY` | Google Maps key (optional) |
| `CLOUDFRONT_DISTRIBUTION_ID` | CloudFront distribution ID |

---

## Step 6: Load Testing with ALB + Auto Scaling

This section sets up ALB and Auto Scaling **temporarily** for load testing. Tear it down after testing to avoid charges.

### 6.1 Create an AMI from Your EC2 Instance

```bash
# Get current instance ID
INSTANCE_ID=$(aws ec2 describe-instances \
  --filters "Name=tag:Name,Values=tripsync-backend" "Name=instance-state-name,Values=running" \
  --query 'Reservations[0].Instances[0].InstanceId' --output text)

# Create AMI
aws ec2 create-image \
  --instance-id $INSTANCE_ID \
  --name "tripsync-backend-ami-$(date +%Y%m%d)" \
  --description "TripSync backend with Docker" \
  --query 'ImageId' --output text
# Save as AMI_ID
```

### 6.2 Create a Launch Template

```bash
aws ec2 create-launch-template \
  --launch-template-name tripsync-lt \
  --version-description "v1" \
  --launch-template-data '{
    "ImageId": "<AMI_ID>",
    "InstanceType": "t2.micro",
    "KeyName": "tripsync-key",
    "SecurityGroupIds": ["<EC2_SG_ID>"],
    "UserData": "'$(echo '#!/bin/bash
aws ecr get-login-password --region ap-southeast-1 | docker login --username AWS --password-stdin <ACCOUNT_ID>.dkr.ecr.ap-southeast-1.amazonaws.com
docker pull <ACCOUNT_ID>.dkr.ecr.ap-southeast-1.amazonaws.com/tripsync-backend:latest
docker run -d --name tripsync --restart unless-stopped -p 8000:8000 \
  -e DATABASE_URL="<DATABASE_URL>" \
  -e SECRET_KEY="<SECRET_KEY>" \
  -e FRONTEND_ORIGIN="<FRONTEND_ORIGIN>" \
  <ACCOUNT_ID>.dkr.ecr.ap-southeast-1.amazonaws.com/tripsync-backend:latest' | base64)'"
  }'
```

### 6.3 Create ALB

```bash
# Create ALB security group
aws ec2 create-security-group \
  --group-name tripsync-alb-sg \
  --description "ALB security group" \
  --query 'GroupId' --output text
# Save as ALB_SG_ID

aws ec2 authorize-security-group-ingress \
  --group-id <ALB_SG_ID> \
  --protocol tcp --port 80 --cidr 0.0.0.0/0

# Get subnet IDs (need at least 2 AZs)
aws ec2 describe-subnets \
  --query 'Subnets[*].[SubnetId,AvailabilityZone]' --output table

# Create ALB
aws elbv2 create-load-balancer \
  --name tripsync-alb \
  --subnets <SUBNET_1> <SUBNET_2> \
  --security-groups <ALB_SG_ID> \
  --query 'LoadBalancers[0].LoadBalancerArn' --output text
# Save as ALB_ARN

# Create target group
aws elbv2 create-target-group \
  --name tripsync-tg \
  --protocol HTTP \
  --port 8000 \
  --vpc-id <VPC_ID> \
  --health-check-path /v1/docs \
  --health-check-interval-seconds 30 \
  --query 'TargetGroups[0].TargetGroupArn' --output text
# Save as TG_ARN

# Create listener
aws elbv2 create-listener \
  --load-balancer-arn <ALB_ARN> \
  --protocol HTTP \
  --port 80 \
  --default-actions Type=forward,TargetGroupArn=<TG_ARN>
```

### 6.4 Create Auto Scaling Group

```bash
aws autoscaling create-auto-scaling-group \
  --auto-scaling-group-name tripsync-asg \
  --launch-template LaunchTemplateName=tripsync-lt,Version='$Latest' \
  --min-size 1 \
  --max-size 4 \
  --desired-capacity 2 \
  --target-group-arns <TG_ARN> \
  --availability-zones ap-southeast-1a ap-southeast-1b

# Add CPU-based scaling policy
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

### 6.5 Run Load Test with Locust

Install Locust locally:

```bash
pip install locust
```

Create `loadtest/locustfile.py`:

```python
from locust import HttpUser, task, between
import random
import string


class TripSyncUser(HttpUser):
    wait_time = between(1, 3)
    host = "http://<ALB_DNS_NAME>"  # or EC2 IP for single-instance test

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

Run the load test:

```bash
cd loadtest

# Web UI mode (recommended) — opens at http://localhost:8089
locust -f locustfile.py

# Or headless mode
locust -f locustfile.py --headless \
  -u 100 \        # 100 concurrent users
  -r 10 \         # spawn 10 users/second
  -t 5m \         # run for 5 minutes
  --host http://<ALB_DNS_NAME>
```

**What to look for:**
- **Avg response time** — should be < 200ms for reads, < 500ms for writes
- **Failure rate** — should be < 1%
- **Requests/sec** — throughput under load
- **95th percentile** — tail latency

### 6.6 Tear Down Load Test Infrastructure

**Important: Do this right after testing to avoid charges.**

```bash
# Delete Auto Scaling Group (terminates extra instances)
aws autoscaling delete-auto-scaling-group \
  --auto-scaling-group-name tripsync-asg \
  --force-delete

# Delete ALB
aws elbv2 delete-listener --listener-arn <LISTENER_ARN>
aws elbv2 delete-target-group --target-group-arn <TG_ARN>
aws elbv2 delete-load-balancer --load-balancer-arn <ALB_ARN>

# Delete ALB security group (wait ~1 min for ALB to fully delete)
aws ec2 delete-security-group --group-id <ALB_SG_ID>

# Delete launch template
aws ec2 delete-launch-template --launch-template-name tripsync-lt

# Deregister AMI
aws ec2 deregister-image --image-id <AMI_ID>
```

Your original single EC2 instance remains running (free tier).

---

## Step 7: Verify Deployment

### Checklist

```
[ ] RDS instance running and accessible from EC2
[ ] Backend container running on EC2 (docker ps)
[ ] Database migrations applied (alembic upgrade head)
[ ] Backend health check: curl http://<EC2_IP>:8000/v1/docs
[ ] Frontend built with production API URL
[ ] S3 bucket populated with frontend dist files
[ ] CloudFront distribution deployed and serving HTTPS
[ ] Frontend loads at https://<CLOUDFRONT_DOMAIN>
[ ] CORS configured: FRONTEND_ORIGIN matches CloudFront domain
[ ] User registration and login work
[ ] Itinerary CRUD works
[ ] Collaborative editing works (test with two browser tabs)
[ ] AI Chat works (if GEMINI_API_KEY is set)
[ ] Map panel works (if VITE_GOOGLE_MAPS_KEY is set)
[ ] PDF export downloads successfully
[ ] GitHub Actions deploys on push to main
```

---

## Cost Summary

| Service | Free Tier Allowance | TripSync Usage | Monthly Cost |
|---------|-------------------|---------------|-------------|
| EC2 (t2.micro) | 750 hrs/mo | 1 instance 24/7 | $0 |
| RDS (db.t3.micro) | 750 hrs/mo, 20 GB | 1 instance 24/7 | $0 |
| S3 | 5 GB, 20K GET | ~10 MB static files | $0 |
| CloudFront | 1 TB/mo, 10M req | Minimal traffic | $0 |
| ECR | 500 MB/mo | ~200 MB image | $0 |
| **Load test (temp)** | — | ALB + 2-4 instances, 2-3 hours | **~$0.50** |
| **Total (normal)** | | | **$0** |

> All costs assume within the first 12 months of AWS free tier eligibility.
> **After 12 months**, EC2 t2.micro (~$8.5/mo) and RDS db.t3.micro (~$12.5/mo) will start charging. Remember to terminate resources after the course ends.

---

## Troubleshooting

### Backend container won't start

```bash
# Check container logs
docker logs tripsync

# Common issues:
# - DATABASE_URL wrong → "connection refused" or "could not translate host name"
# - SECRET_KEY missing → pydantic validation error on startup
```

### Can't connect EC2 to RDS

```bash
# Verify RDS security group allows EC2 SG
aws ec2 describe-security-groups --group-ids <RDS_SG_ID>

# Test connectivity from EC2
docker exec tripsync python -c "
import asyncio, asyncpg
asyncio.run(asyncpg.connect('postgresql://tripsync_admin:<PWD>@<RDS_ENDPOINT>/tripsync'))
print('OK')
"
```

### CloudFront returns 403

- Check S3 bucket policy allows public read
- Check CloudFront origin points to the correct S3 bucket
- Check `DefaultRootObject` is set to `index.html`

### Frontend API calls fail (CORS)

- Verify `FRONTEND_ORIGIN` env variable matches your CloudFront domain exactly (including `https://`)
- Rebuild and redeploy backend container after changing CORS config
- Check browser console for the exact CORS error

### React Router 404 on refresh

- The CloudFront `CustomErrorResponses` config maps 404 → `/index.html` (200) so that React Router handles client-side routing
- If you get 404s on page refresh, verify this error response rule is in place
