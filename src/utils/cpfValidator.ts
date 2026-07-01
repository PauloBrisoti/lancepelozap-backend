export function isValidCPF(cpf: string): boolean {
  if (!cpf) return false;

  // Remove caracteres não numéricos
  cpf = cpf.replace(/[^\d]+/g, '');

  // CPF deve ter 11 dígitos
  if (cpf.length !== 11) return false;

  // Elimina CPFs invalidos conhecidos
  if (/^(\d)\1+$/.test(cpf)) return false;

  // Valida 1o digito
  let add = 0;
  for (let i = 0; i < 9; i++) {
    add += parseInt(cpf.charAt(i)) * (10 - i);
  }
  let rev = 11 - (add % 11);
  if (rev === 10 || rev === 11) rev = 0;
  if (rev !== parseInt(cpf.charAt(9))) return false;

  // Valida 2o digito
  add = 0;
  for (let i = 0; i < 10; i++) {
    add += parseInt(cpf.charAt(i)) * (11 - i);
  }
  rev = 11 - (add % 11);
  if (rev === 10 || rev === 11) rev = 0;
  if (rev !== parseInt(cpf.charAt(10))) return false;

  return true;
}
