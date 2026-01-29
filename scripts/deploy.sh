#!/bin/bash
set -e

SERVER=${1:-"root@your-server-ip"}

echo "Deploying to $SERVER..."

ssh $SERVER << 'EOF'
cd ~/outreach-service
git pull origin main
npm ci
npm run build
pm2 restart outreach || pm2 start ecosystem.config.cjs --env production
pm2 save
pm2 list
EOF

echo "Done!"
