async function test() {
  const loginRes = await fetch('http://localhost:3001/api/auth/login', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: 'admin@saas.com', password: 'admin' })
  });
  const loginData = await loginRes.json();
  
  if (!loginData.token) {
    console.error('Login failed:', loginData);
    return;
  }

  const salesRes = await fetch('http://localhost:3001/api/sales', {
    headers: { 'Authorization': `Bearer ${loginData.token}` }
  });
  const salesData = await salesRes.json();
  console.log('Sales Data:', salesData);
}

test();
