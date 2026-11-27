export function saveUser(first: string, second: string, third: string, fourth: string) {
  const user = { name: first + second + third + fourth };
  const name = user.name;
  return name;
}
