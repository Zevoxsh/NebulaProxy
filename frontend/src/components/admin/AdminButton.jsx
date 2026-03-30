import { Button } from "@/components/ui/button"
import { cn } from "@/lib/utils"

/**
 * AdminButton - Button component with admin theme variants
 * @param {Object} props
 * @param {string} props.variant - Button variant (default, secondary, danger, ghost, outline)
 * @param {string} props.size - Button size (default, sm, lg, icon)
 * @param {string} props.className - Additional CSS classes
 */
export function AdminButton({ variant = "default", size = "default", className, ...props }) {
  const variants = {
    default: "bg-admin-primary hover:bg-admin-primary-strong text-admin-primary-foreground border-admin-primary",
    secondary: "bg-admin-border hover:bg-admin-border-strong text-admin-text border-admin-border",
    danger: "bg-admin-danger/20 border-admin-danger/40 text-red-200 hover:bg-admin-danger/30 hover:border-admin-danger/60",
    ghost: "hover:bg-admin-primary/10 border-admin-border text-admin-text hover:text-admin-primary",
    outline: "border-admin-border text-admin-text hover:bg-admin-surface hover:text-admin-primary",
    success: "bg-admin-success/20 border-admin-success/40 text-green-200 hover:bg-admin-success/30 hover:border-admin-success/60"
  }

  return (
    <Button
      size={size}
      className={cn(variants[variant] || variants.default, className)}
      {...props}
    />
  )
}
