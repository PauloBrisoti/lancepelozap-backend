const http = require('http');

async function run() {
  const loginData = JSON.stringify({ email: 'admin@lancepelozap.com.br', password: '123' }); // I don't know the password...
  // wait, I can just generate a token using the JWT_SECRET from .env!
}
