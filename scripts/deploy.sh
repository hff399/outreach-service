#!/bin/bash

# Manual Deployment Script
# Usage: ./scripts/deploy.sh user@server-ip

set -e

if [ -z "$1" ]; then
    echo "Usage: ./scripts/deploy.sh user@server-ip"
    echo "Example: ./scripts/deploy.sh root@123.456.789.0"
    exit 1
fi

SERVER=$1
REMOTE_DIR="~/outreach-service"

echo "=== Building application ==="

# Build all packages
npm run build

echo "=== Deploying to $SERVER ==="

# Sync files to server
rsync -avz --progress \
    --exclude 'node_modules' \
    --exclude '.git' \
    --exclude 'sessions' \
    --exclude 'uploads' \
    --exclude '.env' \
    --exclude 'logs' \
    --exclude '.next/cache' \
    ./ $SERVER:$REMOTE_DIR/

echo "=== Installing dependencies and restarting services ==="

ssh $SERVER << 'ENDSSH'
    cd ~/outreach-service

    # Install production dependencies
    npm ci --omit=dev

    # Create necessary directories
    mkdir -p apps/backend/sessions apps/backend/uploads apps/backend/logs apps/frontend/logs

    # Restart backend with PM2
    cd apps/backend
    pm2 stop outreach-backend 2>/dev/null || true
    pm2 start ecosystem.config.cjs --env production

    # Restart frontend with PM2
    cd ../frontend
    pm2 stop outreach-frontend 2>/dev/null || true
    pm2 start ecosystem.config.cjs --env production

    pm2 save

    echo ""
    echo "=== Deployment Status ==="
    pm2 list
ENDSSH

echo ""
echo "=== Deployment completed! ==="
