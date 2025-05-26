export const getRedirectUrl = (plan: string) => {
  return `${process.env.FRONTEND_URL}/planes#${plan}`;
};