import "dotenv/config";
import { prisma } from "../lib/prisma";
import jwt from "jsonwebtoken";

async function main() {
  if (!process.env.JWT_SECRET) throw new Error('JWT_SECRET não configurado');
  const token = jwt.sign({ id: "123", role: "SUPER_ADMIN" }, process.env.JWT_SECRET);
  
  const res = await fetch(`http://localhost:3001/api/super-admin/clients`, {
    method: 'POST',
    headers: {
      "Cookie": `authToken=${token}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      nomeFantasia: "Teste",
      emailResponsavel: "teste2@example.com",
      senhaResponsavel: "123"
    })
  });
  const text = await res.text();
  console.log("Response:", res.status, text);
}
main();
