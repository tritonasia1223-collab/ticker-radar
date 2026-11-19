import * as React from "react";
import * as Primitive from "@radix-ui/react-dialog";
import { X } from "lucide-react";
import { cn } from "@/lib/utils";

export const Dialog = Primitive.Root;
export const DialogTitle = Primitive.Title;
export function DialogDescription(props: React.ComponentPropsWithoutRef<typeof Primitive.Description>) {
  return <Primitive.Description {...props} className={cn("text-sm text-muted-foreground", props.className)} />;
}
export function DialogHeader(props: React.HTMLAttributes<HTMLDivElement>) {
  return <div {...props} className={cn("space-y-2 font-medium", props.className)} />;
}
export function DialogContent({ children, className, ...props }: React.ComponentPropsWithoutRef<typeof Primitive.Content>) {
  return <Primitive.Portal>
    <Primitive.Overlay className="fixed inset-0 z-50 bg-black/45" />
    <Primitive.Content {...props} className={cn("fixed left-1/2 top-1/2 z-50 grid w-[calc(100%-2rem)] -translate-x-1/2 -translate-y-1/2 gap-5 rounded-xl border glass-strong prism-edge p-6 shadow-xl focus:outline-none", className)}>
      {children}
      <Primitive.Close aria-label="닫기" className="absolute right-3 top-3 rounded p-1 text-muted-foreground hover:bg-accent"><X size={16} /></Primitive.Close>
    </Primitive.Content>
  </Primitive.Portal>;
}
