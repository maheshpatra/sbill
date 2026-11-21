import { CustomerForm } from "@/components/customer-form";

export default function NewCustomerPage() {
  return (
    <div className="space-y-4">
      <h1 className="text-2xl font-bold">New customer</h1>
      <CustomerForm />
    </div>
  );
}
