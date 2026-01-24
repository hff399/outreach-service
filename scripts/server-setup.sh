#!/bin/bash

# Server Setup Script for Timeweb VPS
# Run this once on a fresh server

set -e

echo "=== Outreach Service Server Setup ==="

# Update system
echo "Updating system packages..."
sudo apt update && sudo apt upgrade -y

# Install Node.js 20
echo "Installing Node.js 20..."
curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
sudo apt install -y nodejs

# Install PM2 globally
echo "Installing PM2..."
sudo npm install -g pm2

# Install nginx
echo "Installing Nginx..."
sudo apt install -y nginx

# Create app directory
echo "Creating application directory..."
mkdir -p ~/outreach-service
mkdir -p ~/outreach-service/apps/backend/sessions
mkdir -p ~/outreach-service/apps/backend/uploads
mkdir -p ~/outreach-service/apps/backend/logs
mkdir -p ~/outreach-service/apps/frontend/logs

# Setup PM2 to start on boot
echo "Setting up PM2 startup..."
pm2 startup systemd -u $USER --hp $HOME
sudo env PATH=$PATH:/usr/bin pm2 startup systemd -u $USER --hp $HOME

# Create nginx config
echo "Creating Nginx configuration..."
sudo tee /etc/nginx/sites-available/outreach-service > /dev/null << 'EOF'
server {
    listen 80;
    server_name _;  # Replace with your domain

    # Frontend
    location / {
        proxy_pass http://127.0.0.1:3000;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection 'upgrade';
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_cache_bypass $http_upgrade;
    }

    # Backend API
    location /api/ {
        rewrite ^/api/(.*) /$1 break;
        proxy_pass http://127.0.0.1:3001;
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
    }

    # WebSocket
    location /ws {
        proxy_pass http://127.0.0.1:3001;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection "upgrade";
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_read_timeout 86400;
    }

    # Uploads (static files)
    location /uploads/ {
        alias /home/$USER/outreach-service/apps/backend/uploads/;
        expires 30d;
        add_header Cache-Control "public, immutable";
    }
}
EOF

# Enable site
sudo ln -sf /etc/nginx/sites-available/outreach-service /etc/nginx/sites-enabled/
sudo rm -f /etc/nginx/sites-enabled/default

# Test and reload nginx
sudo nginx -t && sudo systemctl reload nginx

# Setup firewall
echo "Configuring firewall..."
sudo ufw allow 22/tcp
sudo ufw allow 80/tcp
sudo ufw allow 443/tcp
sudo ufw --force enable

echo ""
echo "=== Setup Complete ==="
echo ""
echo "Next steps:"
echo "1. Copy your .env file to ~/outreach-service/.env"
echo "2. Set up GitHub secrets for deployment:"
echo "   - SSH_PRIVATE_KEY: Your SSH private key"
echo "   - SERVER_HOST: Your server IP or hostname"
echo "   - SERVER_USER: Your SSH username (usually 'root' or your username)"
echo ""
echo "3. For HTTPS, install certbot:"
echo "   sudo apt install certbot python3-certbot-nginx"
echo "   sudo certbot --nginx -d your-domain.com"
echo ""
echo "4. Push to main branch to trigger deployment"
