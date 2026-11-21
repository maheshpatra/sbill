"use client";

import { AuthCard } from "@/components/auth-card";
import { FirstRun } from "@/components/intro-slides";

export default function SignupPage() {
  return (
    <FirstRun>
      <AuthCard mode="signup" />
    </FirstRun>
  );
}
