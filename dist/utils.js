export const getRedirectUrl = (plan) => {
    return `${process.env.FRONTEND_URL}/planes#${plan}`;
};
