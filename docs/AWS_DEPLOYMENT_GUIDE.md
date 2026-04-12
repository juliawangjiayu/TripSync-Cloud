# TripSync AWS Deployment Guide

> **This guide is designed to be followed strictly from top to bottom.** Every command can be copied and pasted into your terminal in order. No jumping ahead or going back required.

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
3. **Docker Desktop** installed locally (open the app and wait for it to show "running" before using docker commands)
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
aws ec2 create-security-group \
  --group-name tripsync-rds-sg \
  --description "Security group for TripSync RDS" \
  --query 'GroupId' --output text
```

Save the output (e.g. `sg-0d2b882ec1aaaa777`) — this is your **RDS_SG_ID**.

> We will add the inbound rule (allow PostgreSQL from EC2) later in Step 3.2, after the EC2 security group exists.

### 1.2 Create the RDS Instance

Replace `<RDS_SG_ID>` with the value from Step 1.1.

```bash
aws rds create-db-instance \
  --db-instance-identifier tripsync-db \
  --db-instance-class db.t3.micro \
  --engine postgres \
  --master-username tripsync_admin \
  --master-user-password 'MyTripSync2026' \
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

RDS takes ~5-10 minutes to create. Check status:

```bash
aws rds describe-db-instances \
  --db-instance-identifier tripsync-db \
  --query 'DBInstances[0].DBInstanceStatus' --output text
```

Repeat until the output is `available`, then get the endpoint:

```bash
aws rds describe-db-instances \
  --db-instance-identifier tripsync-db \
  --query 'DBInstances[0].Endpoint.Address' --output text
```

Save the output — this is your **RDS_ENDPOINT**. Your `DATABASE_URL` will be:
```
postgresql+asyncpg://tripsync_admin:MyTripSync2026@tripsync-db.chiyeaew08uk.ap-southeast-1.rds.amazonaws.com:5432/tripsync
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
    libpango-1.0-0 libpangocairo-1.0-0 libgdk-pixbuf-2.0-0 \
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

### 2.3 Build Docker Image

Make sure Docker Desktop is open and running, then:

```bash
cd backend
docker build --platform linux/amd64 -t tripsync-backend .
```

---

## Step 3: Set Up EC2 (Security Groups, IAM, Key Pair, Launch)

aws ec2 terminate-instances --instance-ids $(aws ec2 describe-instances --filters "Name=tag:Name,Values=tripsync-backend" "Name=instance-state-name,Values=running" --query 'Reservations[0]. Instances[0].InstanceId' --output text)

aws ec2 describe-security-groups --filters "Name=group-name,Values=tripsync-ec2-sg" --query  'SecurityGroups[0].GroupId' --output text
### 3.1 Create Security Group for EC2

```bash
aws ec2 create-security-group \
  --group-name tripsync-ec2-sg \
  --description "Security group for TripSync EC2" \
  --query 'GroupId' --output text
```

Save the output — this is your **EC2_SG_ID**.
EC2_SG_ID:sg-06c85806831dd5585

Now add inbound rules. Replace `<EC2_SG_ID>` with the value above:

```bash
aws ec2 authorize-security-group-ingress \
  --group-id <EC2_SG_ID> \
  --protocol tcp --port 22 --cidr 0.0.0.0/0
```

```bash
aws ec2 authorize-security-group-ingress \
  --group-id <EC2_SG_ID> \
  --protocol tcp --port 8000 --cidr 0.0.0.0/0
```

### 3.2 Allow EC2 to Access RDS

Now that both security groups exist, add the inbound rule to the RDS security group. Replace `<RDS_SG_ID>` and `<EC2_SG_ID>`:

```bash
aws ec2 authorize-security-group-ingress \
  --group-id <RDS_SG_ID> \
  --protocol tcp --port 5432 \
  --source-group <EC2_SG_ID>
```

### 3.3 Create Key Pair

```bash
aws ec2 create-key-pair \
  --key-name tripsync-key \
  --query 'KeyMaterial' --output text > tripsync-key.pem

chmod 400 tripsync-key.pem
```

> The private key is saved to `tripsync-key.pem` in your current directory. **Do not delete this file** — you need it to SSH into EC2. Do not run this command again — AWS only gives the private key once.

### 3.4 Create IAM Role for EC2 (ECR Access)

The EC2 instance needs permission to pull Docker images from ECR. **This must be done before launching the instance.**

```bash
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
```

```bash
aws iam attach-role-policy \
  --role-name tripsync-ec2-role \
  --policy-arn arn:aws:iam::aws:policy/AmazonEC2ContainerRegistryReadOnly
```

```bash
aws iam create-instance-profile \
  --instance-profile-name tripsync-ec2-profile
```

```bash
aws iam add-role-to-instance-profile \
  --instance-profile-name tripsync-ec2-profile \
  --role-name tripsync-ec2-role
```

> IAM resources take a few seconds to propagate. **Wait ~15 seconds** before proceeding to the next step.

### 3.5 Launch EC2 Instance

Replace `<EC2_SG_ID>` with your EC2 security group ID:

```bash
AMI_ID=$(aws ec2 describe-images --owners amazon --filters "Name=name,Values=amzn2-ami-hvm-*-x86_64-gp2" "Name=state,Values=available" --query 'sort_by(Images,&CreationDate)[-1].ImageId' --output text)
echo "Using AMI: $AMI_ID"
```

```bash
aws ec2 run-instances \
  --image-id $AMI_ID \
  --instance-type t2.micro \
  --key-name tripsync-key \
  --security-group-ids sg-06c85806831dd5585 \
  --iam-instance-profile Name=tripsync-ec2-profile \
  --tag-specifications 'ResourceType=instance,Tags=[{Key=Name,Value=tripsync-backend}]' \
  --user-data '#!/bin/bash
yum install -y docker
systemctl start docker
systemctl enable docker
usermod -aG docker ec2-user' \
  --query 'Instances[0].InstanceId' --output text
```

Save the output — this is your **Instance ID**.

> The instance takes ~2 minutes to initialize and run the user-data script (installs Docker).

### 3.6 Wait for Instance to be Ready

Replace `<INSTANCE_ID>`i-0472fc7b33ba3ed3e with the value from Step 3.5:

```bash
aws ec2 describe-instance-status --instance-ids i-0472fc7b33ba3ed3e --query 'InstanceStatuses[0].[InstanceState.Name,InstanceStatus.Status,SystemStatus.Status]' --output text
```

Repeat until the output is `running  ok  ok`.

### 3.7 Get Public IP

```bash
aws ec2 describe-instances \
  --filters "Name=tag:Name,Values=tripsync-backend" "Name=instance-state-name,Values=running" \
  --query 'Reservations[0].Instances[0].PublicIpAddress' --output text
```

Save the output — this is your **EC2_PUBLIC_IP**18.142.57.92.

### 3.8 SSH into EC2

```bash
ssh -i tripsync-key.pem ec2-user@18.142.57.92
```

> If you get `Connection closed by ... port 22`, wait another minute and try again — the instance may still be initializing.
>
> If SSH still fails after several minutes, try connecting via the **AWS Console** instead: EC2 → Instances → select your instance → Connect → EC2 Instance Connect → Connect.

Once connected, verify Docker is running:

```bash
docker ps
```

Then **exit** back to your local machine:

```bash
exit
```

---

## Step 4: Push Docker Image to ECR

ECR free tier: 500 MB storage/month for private repos (first year).

Run these commands **on your local machine** (not on EC2).

### 4.1 Create ECR Repository

```bash
aws ecr create-repository --repository-name tripsync-backend \
  --query 'repository.repositoryUri' --output text
```

The output will look like `486027077509.dkr.ecr.ap-southeast-1.amazonaws.com/tripsync-backend`. The part before `/tripsync-backend` is your **ECR registry URL**.

### 4.2 Login, Tag, and Push

Replace `486027077509` with your AWS Account ID if different:

```bash
aws ecr get-login-password --region ap-southeast-1 | \
  docker login --username AWS --password-stdin \
  486027077509.dkr.ecr.ap-southeast-1.amazonaws.com
```

```bash
docker tag tripsync-backend:latest \
  486027077509.dkr.ecr.ap-southeast-1.amazonaws.com/tripsync-backend:latest
```

```bash
docker push \
  486027077509.dkr.ecr.ap-southeast-1.amazonaws.com/tripsync-backend:latest
```

---

## Step 5: Deploy Backend on EC2

### 5.1 SSH into EC2

```bash
ssh -i tripsync-key.pem ec2-user@18.142.57.92
```

### 5.2 Pull and Run the Container

Run these commands **on EC2** (after SSH). Replace `486027077509` with your Account ID if different:

```bash
aws ecr get-login-password --region ap-southeast-1 | \
  docker login --username AWS --password-stdin \
  486027077509.dkr.ecr.ap-southeast-1.amazonaws.com
```

```bash
docker pull 486027077509.dkr.ecr.ap-southeast-1.amazonaws.com/tripsync-backend:latest
```

Replace `<RDS_ENDPOINT>`, `<YOUR_SECRET_KEY>`, and `<YOUR_GEMINI_KEY>` below:

```bash
docker run -d --name tripsync \
  --restart unless-stopped \
  -p 8000:8000 \
  -e DATABASE_URL="postgresql+asyncpg://tripsync_admin:MyTripSync2026@tripsync-db.chiyeaew08uk.ap-southeast-1.rds.amazonaws.com:5432/tripsync" \
  -e SECRET_KEY="LpenytLiCtwHeseZaO2+Wnr5YSqUlLypXLgmYL0+" \
  -e GEMINI_API_KEY="AIzaSyAHBMj6Ibo_frrSGoCuKMRGYTAQ2OJqd2k" \
  -e FRONTEND_ORIGIN="https://placeholder.cloudfront.net" \
  486027077509.dkr.ecr.ap-southeast-1.amazonaws.com/tripsync-backend:latest
```

> `FRONTEND_ORIGIN` is a placeholder for now. We will update it in Step 7 after deploying the frontend.

### 5.3 Run Database Migrations

```bash
docker exec tripsync alembic upgrade head
```

### 5.4 Quick Sanity Check

```bash
exit
```

Back on your local machine:

```bash
curl http://18.142.57.92:8000/v1/docs
```

If you see HTML output (the FastAPI docs page), the backend is running correctly.

---

## Step 6: Deploy Frontend to S3 + CloudFront

### 6.1 Build the Frontend

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
```

### 6.2 Create S3 Bucket

```bash
aws s3 mb s3://tripsync-frontend-486027077509
```

```bash
aws s3 website s3://tripsync-frontend-486027077509 \
  --index-document index.html \
  --error-document index.html
```

### 6.3 Upload Build Files

```bash
aws s3 sync dist/ s3://tripsync-frontend-486027077509/ \
  --delete \
  --cache-control "public, max-age=31536000" \
  --exclude "index.html"
```

```bash
aws s3 cp dist/index.html s3://tripsync-frontend-486027077509/index.html \
  --cache-control "no-cache, no-store, must-revalidate"
```

### 6.4 Create CloudFront Distribution

Create a file called `cloudfront-config.json` in your current directory:

```json
{
  "CallerReference": "tripsync-1",
  "Origins": {
    "Quantity": 1,
    "Items": [
      {
        "Id": "S3-tripsync-frontend",
        "DomainName": "tripsync-frontend-486027077509.s3.ap-southeast-1.amazonaws.com",
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
```

Save the output (`d122amyq22pv4d.cloudfront.net`) — this is your **CLOUDFRONT_DOMAIN**.

### 6.5 Update S3 Bucket Policy

```bash
aws s3api put-bucket-policy --bucket tripsync-frontend-486027077509 --policy '{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Sid": "PublicRead",
      "Effect": "Allow",
      "Principal": "*",
      "Action": "s3:GetObject",
      "Resource": "arn:aws:s3:::tripsync-frontend-486027077509/*"
    }
  ]
}'
```

---

## Step 7: Update Backend CORS and Redeploy

Now that you have the CloudFront domain, update the backend CORS and redeploy.

### 7.1 Update CORS in Code

Update `backend/app/main.py` to use the `FRONTEND_ORIGIN` env variable:

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

### 7.2 Rebuild and Push to ECR

On your local machine:

```bash
cd backend
docker build --platform linux/amd64 -t tripsync-backend .
```

```bash
docker tag tripsync-backend:latest \
  486027077509.dkr.ecr.ap-southeast-1.amazonaws.com/tripsync-backend:latest
```

```bash
aws ecr get-login-password --region ap-southeast-1 | \
  docker login --username AWS --password-stdin \
  486027077509.dkr.ecr.ap-southeast-1.amazonaws.com
```

```bash
docker push \
  486027077509.dkr.ecr.ap-southeast-1.amazonaws.com/tripsync-backend:latest
```

### 7.3 Redeploy on EC2

```bash
ssh -i tripsync-key.pem ec2-user@18.142.57.92
```

On EC2:

```bash
aws ecr get-login-password --region ap-southeast-1 | \
  docker login --username AWS --password-stdin \
  486027077509.dkr.ecr.ap-southeast-1.amazonaws.com
```

```bash
docker stop tripsync
docker rm tripsync
```

```bash
docker pull 486027077509.dkr.ecr.ap-southeast-1.amazonaws.com/tripsync-backend:latest
```

Replace `<RDS_ENDPOINT>`, `<YOUR_SECRET_KEY>`, `<YOUR_GEMINI_KEY>`, and `<CLOUDFRONT_DOMAIN>`:

```bash
docker run -d --name tripsync \
  --restart unless-stopped \
  -p 8000:8000 \
  -e DATABASE_URL="postgresql+asyncpg://tripsync_admin:MyTripSync2026@tripsync-db.chiyeaew08uk.ap-southeast-1.rds.amazonaws.com:5432/tripsync" \
  -e SECRET_KEY="LpenytLiCtwHeseZaO2+Wnr5YSqUlLypXLgmYL0+" \
  -e GEMINI_API_KEY="<YOUR_GEMINI_KEY>" \
  -e FRONTEND_ORIGIN="https://d122amyq22pv4d.cloudfront.net" \
  486027077509.dkr.ecr.ap-southeast-1.amazonaws.com/tripsync-backend:latest
```

```bash
docker image prune -f
exit
```

---

## Step 8: GitHub Actions CI/CD

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
| `AWS_ACCOUNT_ID` | `486027077509` |
| `EC2_HOST` | EC2 public IP |
| `EC2_SSH_KEY` | Content of `tripsync-key.pem` |
| `DATABASE_URL` | `postgresql+asyncpg://tripsync_admin:MyTripSync2026@<RDS_ENDPOINT>:5432/tripsync` |
| `SECRET_KEY` | Your JWT signing key (32+ chars) |
| `GEMINI_API_KEY` | Google Gemini API key (optional) |
| `FRONTEND_ORIGIN` | `https://<CLOUDFRONT_DOMAIN>` |
| `VITE_API_BASE_URL` | `http://<EC2_IP>:8000/v1` |
| `VITE_GOOGLE_MAPS_KEY` | Google Maps key (optional) |
| `CLOUDFRONT_DISTRIBUTION_ID` | CloudFront distribution ID |

---

## Step 9: Load Testing with ALB + Auto Scaling

This section sets up ALB and Auto Scaling **temporarily** for load testing. Tear it down after testing to avoid charges (~$0.50 for 2-3 hours).

**Required info before starting:**
- EC2_SG_ID: `sg-06c85806831dd5585`
- VPC_ID: `vpc-0ae8d8d5139d6cc0b`
- Account ID: `486027077509`

### 9.1 Create an AMI from Your EC2 Instance

```bash
INSTANCE_ID=$(aws ec2 describe-instances \
  --filters "Name=tag:Name,Values=tripsync-backend" "Name=instance-state-name,Values=running" \
  --query 'Reservations[0].Instances[0].InstanceId' --output text)
echo "Instance ID: $INSTANCE_ID"
```

```bash
aws ec2 create-image \
  --instance-id $INSTANCE_ID \
  --name "tripsync-backend-ami-$(date +%Y%m%d)" \
  --description "TripSync backend with Docker" \
  --query 'ImageId' --output text
```

Save the output — this is your **AMI_ID**.

> AMI creation takes 2-5 minutes. Check status before proceeding:
> ```bash
> aws ec2 describe-images --image-ids <AMI_ID> --query 'Images[0].State' --output text
> ```
> Wait until it shows `available`.

### 9.2 Create a Launch Template

Replace `<AMI_ID>` with the value from Step 9.1:

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
  -e FRONTEND_ORIGIN="https://d122amyq22pv4d.cloudfront.net" \
  486027077509.dkr.ecr.ap-southeast-1.amazonaws.com/tripsync-backend:latest' | base64)'"
  }'
```

### 9.3 Create ALB

```bash
aws ec2 create-security-group \
  --group-name tripsync-alb-sg \
  --description "ALB security group" \
  --query 'GroupId' --output text
```

Save the output — this is your **ALB_SG_ID**. Then replace `<ALB_SG_ID>`:

```bash
aws ec2 authorize-security-group-ingress \
  --group-id <ALB_SG_ID> \
  --protocol tcp --port 80 --cidr 0.0.0.0/0
```

Also allow ALB to forward traffic to EC2 instances on port 8000. Replace `<ALB_SG_ID>`:

```bash
aws ec2 authorize-security-group-ingress \
  --group-id sg-06c85806831dd5585 \
  --protocol tcp --port 8000 \
  --source-group <ALB_SG_ID>
```

List subnets to pick two from different AZs:

```bash
aws ec2 describe-subnets \
  --query 'Subnets[*].[SubnetId,AvailabilityZone]' --output table
```

Pick two subnets from different AZs. Replace `<SUBNET_1>`, `<SUBNET_2>`, `<ALB_SG_ID>`:

```bash
aws elbv2 create-load-balancer \
  --name tripsync-alb \
  --subnets <SUBNET_1> <SUBNET_2> \
  --security-groups <ALB_SG_ID> \
  --query 'LoadBalancers[0].[LoadBalancerArn,DNSName]' --output text
```

Save both outputs — **ALB_ARN** (first value) and **ALB_DNS_NAME** (second value, e.g. `tripsync-alb-123456.ap-southeast-1.elb.amazonaws.com`).

```bash
aws elbv2 create-target-group \
  --name tripsync-tg \
  --protocol HTTP \
  --port 8000 \
  --vpc-id vpc-0ae8d8d5139d6cc0b \
  --health-check-path /docs \
  --health-check-interval-seconds 30 \
  --query 'TargetGroups[0].TargetGroupArn' --output text
```

Save the output — this is your **TG_ARN**. Then replace `<ALB_ARN>` and `<TG_ARN>`:

```bash
aws elbv2 create-listener \
  --load-balancer-arn <ALB_ARN> \
  --protocol HTTP \
  --port 80 \
  --default-actions Type=forward,TargetGroupArn=<TG_ARN> \
  --query 'Listeners[0].ListenerArn' --output text
```

Save the output — this is your **LISTENER_ARN** (needed for cleanup in Step 9.6).

### 9.4 Create Auto Scaling Group

Replace `<TG_ARN>`:

```bash
aws autoscaling create-auto-scaling-group \
  --auto-scaling-group-name tripsync-asg \
  --launch-template LaunchTemplateName=tripsync-lt,Version='$Latest' \
  --min-size 1 \
  --max-size 4 \
  --desired-capacity 2 \
  --target-group-arns <TG_ARN> \
  --availability-zones ap-southeast-1a ap-southeast-1b
```

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

> Wait 2-3 minutes for ASG instances to launch and pass health checks. You can verify:
> ```bash
> aws elbv2 describe-target-health --target-group-arn <TG_ARN> --query 'TargetHealthDescriptions[*].[Target.Id,TargetHealth.State]' --output table
> ```
> Wait until targets show `healthy` before running the load test.

### 9.5 Run Load Test with Locust

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

Run the load test. Replace `<ALB_DNS_NAME>` with the ALB DNS from Step 9.3:

```bash
cd loadtest
locust -f locustfile.py --host http://<ALB_DNS_NAME>
```

Open http://localhost:8089 in your browser. In the Web UI:
- **Number of users**: 100
- **Spawn rate**: 10
- Click **Start swarming**

Let it run for ~5 minutes, then click **Stop**.

**What to look for:**
- **Avg response time** — should be < 200ms for reads, < 500ms for writes
- **Failure rate** — should be < 1%
- **Requests/sec** — throughput under load
- **95th percentile** — tail latency

### 9.6 Tear Down Load Test Infrastructure

**Important: Do this right after testing to avoid charges.**

```bash
aws autoscaling delete-auto-scaling-group \
  --auto-scaling-group-name tripsync-asg \
  --force-delete
```

```bash
aws elbv2 delete-listener --listener-arn <LISTENER_ARN>
```

```bash
aws elbv2 delete-target-group --target-group-arn <TG_ARN>
```

```bash
aws elbv2 delete-load-balancer --load-balancer-arn <ALB_ARN>
```

Wait ~1 minute for ALB to fully delete, then:

```bash
aws ec2 delete-security-group --group-id <ALB_SG_ID>
```

```bash
aws ec2 delete-launch-template --launch-template-name tripsync-lt
```

```bash
aws ec2 deregister-image --image-id <AMI_ID>
```

Your original single EC2 instance remains running (free tier).

---

## Step 10: Verify Deployment

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
asyncio.run(asyncpg.connect('postgresql://tripsync_admin:MyTripSync2026@<RDS_ENDPOINT>/tripsync'))
print('OK')
"
```

### SSH connection closed

- Wait 2-3 minutes after instance launch for initialization to complete
- Check instance status: both checks should show `ok`
- Alternative: connect via AWS Console → EC2 → Instances → Connect → EC2 Instance Connect

### CloudFront returns 403

- Check S3 bucket policy allows public read
- Check CloudFront origin points to the correct S3 bucket
- Check `DefaultRootObject` is set to `index.html`

### Frontend API calls fail (CORS)

- Verify `FRONTEND_ORIGIN` env variable matches your CloudFront domain exactly (including `https://`)
- Rebuild and redeploy backend container after changing CORS config (Step 7)
- Check browser console for the exact CORS error

### React Router 404 on refresh

- The CloudFront `CustomErrorResponses` config maps 404 → `/index.html` (200) so that React Router handles client-side routing
- If you get 404s on page refresh, verify this error response rule is in place
