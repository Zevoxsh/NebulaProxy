import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { cn } from "@/lib/utils"

/**
 * AdminModal - Modal dialog component with admin theme
 */
export function AdminModal({ children, ...props }) {
  return <Dialog {...props}>{children}</Dialog>
}

/**
 * AdminModalContent - Modal content with admin theme styling
 */
export function AdminModalContent({ className, ...props }) {
  return (
    <DialogContent
      className={cn(
        "bg-admin-surface border-admin-border text-admin-text max-w-2xl",
        className
      )}
      {...props}
    />
  )
}

/**
 * AdminModalHeader - Modal header with admin theme
 */
export function AdminModalHeader({ className, ...props }) {
  return (
    <DialogHeader
      className={cn("border-b border-admin-border pb-4", className)}
      {...props}
    />
  )
}

/**
 * AdminModalTitle - Modal title with admin theme
 */
export function AdminModalTitle({ className, ...props }) {
  return (
    <DialogTitle
      className={cn("text-admin-text font-semibold text-xl", className)}
      {...props}
    />
  )
}

/**
 * AdminModalDescription - Modal description with admin theme
 */
export function AdminModalDescription({ className, ...props }) {
  return (
    <DialogDescription
      className={cn("text-admin-text-muted", className)}
      {...props}
    />
  )
}

/**
 * AdminModalFooter - Modal footer with admin theme
 */
export function AdminModalFooter({ className, ...props }) {
  return (
    <DialogFooter
      className={cn("border-t border-admin-border pt-4 gap-2", className)}
      {...props}
    />
  )
}
