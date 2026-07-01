import http from 'http';

async function test() {
  const loginRes = await fetch('http://localhost:3001/api/auth/login', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: 'admin@example.com', password: '123456' })
  });
  
  if (!loginRes.ok) {
    console.log('Login failed', loginRes.status, await loginRes.text());
    return;
  }
  
  const cookie = loginRes.headers.get('set-cookie');
  console.log('Logged in', cookie);
  
  const createRes = await fetch('http://localhost:3001/api/categories', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Cookie': cookie || '' },
    body: JSON.stringify({ nome: 'HttpTeste' })
  });
  
  console.log('Category Create', createRes.status, await createRes.text());
}
test().catch(console.log);
