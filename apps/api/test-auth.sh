bash# test-auth.sh
#!/bin/bash

echo "=== TEST AUTHENTIFICATION ==="
echo ""

echo "1. Test health (public):"
curl -s http://172.17.5.198:4000/api/v1/health
echo -e "\n"

echo "2. Test login:"
RESPONSE=$(curl -s -X POST http://172.17.5.198:4000/api/v1/auth/login \
  -H "Content-Type: application/json" \
  -d '{"email":"mohamed.boujelbane@monetiquetunisie.com","password":"smt@2025"}')

echo "$RESPONSE"
echo ""

TOKEN=$(echo "$RESPONSE" | grep -o '"token":"[^"]*' | grep -o '[^"]*$')

if [ -z "$TOKEN" ]; then
  echo "❌ Échec: Token non reçu"
  exit 1
fi

echo "✅ Token reçu: ${TOKEN:0:20}..."
echo ""

echo "3. Test route protégée (dashboard):"
curl -s http://172.17.5.198:4000/api/v1/dashboard \
  -H "Authorization: Bearer $TOKEN"
echo ""

echo ""
echo "=== FIN TEST ==="
