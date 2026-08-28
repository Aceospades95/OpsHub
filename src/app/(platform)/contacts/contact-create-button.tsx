"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Plus } from "lucide-react";
import { createContact } from "@/actions/contacts";
import { ContactFormDialog } from "./contact-form-dialog";

export function ContactCreateButton() {
  const [open, setOpen] = useState(false);
  const router = useRouter();

  return (
    <>
      <Button onClick={() => setOpen(true)}>
        <Plus className="h-4 w-4 mr-1" />
        New Contact
      </Button>
      {open && (
        <ContactFormDialog
          title="New Contact"
          submitLabel="Create"
          onClose={() => setOpen(false)}
          onSubmit={async (values) => {
            const result = await createContact(values);
            if (result.error) return result;
            toast.success("Contact created");
            setOpen(false);
            if (result.contactId) {
              router.push(`/contacts/${result.contactId}`);
            } else {
              router.refresh();
            }
          }}
        />
      )}
    </>
  );
}
