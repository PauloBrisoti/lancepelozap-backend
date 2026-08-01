import { prisma } from "../lib/prisma";
import jwt from "jsonwebtoken";

async function main() {
  const store = await prisma.store.findFirst();
  if (!store) { console.log("No store"); return; }
  
  if (!process.env.JWT_SECRET) throw new Error('JWT_SECRET não configurado');
  const token = jwt.sign({ id: "123", role: "SUPER_ADMIN" }, process.env.JWT_SECRET);
  
  const res = await fetch(`http://localhost:3001/api/super-admin/impersonate/${store.id}`, {
    method: 'POST',
    headers: {
      "Cookie": `authToken=${token}`
    }
  });
  const text = await res.text();
  console.log("Response:", res.status, text);
}
main();
