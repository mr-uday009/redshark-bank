import LoginForm from "@/components/LoginForm";
import { LogoFull } from "@/components/Logo";
import { getSession } from "@/lib/session";
import { redirect } from "next/navigation";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";

export default async function LoginPage() {
  const session = await getSession();
  if (session) redirect("/");

  return (
    <main className="flex min-h-screen flex-col items-center justify-center px-6 py-12">
      <div className="w-full max-w-sm">
        <div className="mb-8 flex flex-col items-center text-center">
          <LogoFull className="h-16" />
          <p className="mt-3 text-sm text-muted-foreground">
            Secure online banking.
          </p>
        </div>

        <Card>
          <CardHeader>
            <CardTitle>Sign in</CardTitle>
            <CardDescription>
              Enter your details to access your account.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <LoginForm />
          </CardContent>
        </Card>

        {/* <p className="mt-8 text-center text-xs leading-relaxed text-muted-foreground">
          Passwords are one-way hashed and never stored in plain text.
        </p> */}
      </div>
    </main>
  );
}
