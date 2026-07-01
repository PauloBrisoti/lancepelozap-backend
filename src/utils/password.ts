import bcrypt from "bcryptjs";

export async function hashPassword(password: string): Promise<string> {
  const saltRounds = 12;
  return bcrypt.hash(password, saltRounds);
}

export async function comparePassword(
  plain: string,
  hash: string
): Promise<boolean> {
  return bcrypt.compare(plain, hash);
}
