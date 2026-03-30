import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert"
import { cn } from "@/lib/utils"
import { AlertCircle, CheckCircle, Info, AlertTriangle } from "lucide-react"

/**
 * AdminAlert - Alert component with admin theme variants
 * @param {Object} props
 * @param {string} props.variant - Alert variant (default, success, warning, danger, info)
 */
export function AdminAlert({ variant = "default", className, children, ...props }) {
  const variants = {
    default: "bg-[#18181b] border-[#27272a] text-[#fafafa]",
    success: "bg-[#14532d] border-[#166534] text-[#ecfdf3]",
    warning: "bg-[#14532d] border-[#166534] text-[#ecfdf3]",
    danger: "bg-[#7f1d1d] border-[#991b1b] text-[#fef2f2]",
    info: "bg-[#1f2937] border-[#374151] text-[#f3f4f6]"
  }

  const icons = {
    default: Info,
    success: CheckCircle,
    warning: AlertTriangle,
    danger: AlertCircle,
    info: Info
  }

  const Icon = icons[variant] || icons.default

  return (
    <Alert className={cn(variants[variant] || variants.default, className)} {...props}>
      <Icon className="h-4 w-4" />
      {children}
    </Alert>
  )
}

/**
 * AdminAlertTitle - Alert title with admin theme
 */
export function AdminAlertTitle({ className, ...props }) {
  return <AlertTitle className={cn("font-semibold", className)} {...props} />
}

/**
 * AdminAlertDescription - Alert description with admin theme
 */
export function AdminAlertDescription({ className, ...props }) {
  return <AlertDescription className={cn("text-sm", className)} {...props} />
}
