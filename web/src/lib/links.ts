export function dashboardLinks() {
  const signup =
    process.env.NEXT_PUBLIC_DASHBOARD_URL?.trim() || "http://127.0.0.1:4319/signup";
  let login = "http://127.0.0.1:4319/login";
  try {
    const url = new URL(signup);
    url.pathname = "/login";
    url.search = "";
    url.hash = "";
    login = url.toString();
  } catch {
    login = signup.replace(/signup\/?$/, "login");
  }
  return { signup, login };
}
