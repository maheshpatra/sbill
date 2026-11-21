"use client";

import { AuthCard } from "@/components/auth-card";
import { FirstRun } from "@/components/intro-slides";

export default function LoginPage() {
  return (
    <FirstRun>
      <AuthCard mode="login" />
    </FirstRun>
  );
}
