#!/bin/bash
# Jellyfin Proxy Diagnostic
# This script tests connectivity from INSIDE the NebulaProxy container

echo "🔍 Jellyfin Proxy Backend Diagnostic"
echo "===================================="
echo ""

# Get the proxy container name
PROXY_CONTAINER=$(docker-compose ps -q backend)

if [ -z "$PROXY_CONTAINER" ]; then
  echo "❌ NebulaProxy backend container not found"
  echo "   Run: docker-compose up -d"
  exit 1
fi

echo "📦 Testing from container: $PROXY_CONTAINER"
echo ""

# Test 1: Ping the Jellyfin server
echo "1️⃣  Testing network connectivity to 10.10.0.11..."
docker-compose exec -T backend ping -c 1 10.10.0.11 > /dev/null 2>&1
if [ $? -eq 0 ]; then
  echo "   ✅ Ping successful"
else
  echo "   ❌ Ping failed - network unreachable"
fi

echo ""

# Test 2: Test port connectivity with nc/ncat
echo "2️⃣  Testing port 8096 connectivity..."
docker-compose exec -T backend bash -c 'timeout 3 bash < /dev/null > /dev/tcp/10.10.0.11/8096 2>&1' > /dev/null 2>&1
if [ $? -eq 0 ] || [ $? -eq 124 ]; then
  echo "   ✅ Port 8096 is open/responding"
else
  echo "   ❌ Port 8096 is not responding or blocked"
fi

echo ""

# Test 3: Test actual HTTP request
echo "3️⃣  Testing HTTP request to Jellyfin API..."
echo ""

docker-compose exec -T backend curl -v http://10.10.0.11:8096/System/Info/Public 2>&1 | head -30

echo ""
echo "===================================="
echo "💡 If you see ECONNRESET errors:"
echo "   1. Check Jellyfin logs on 10.10.0.11"
echo "   2. Verify Jellyfin is listening on 0.0.0.0:8096"
echo "   3. Check for firewall rules between proxy and Jellyfin"
echo "   4. Check Jellyfin configuration for connection limits"
