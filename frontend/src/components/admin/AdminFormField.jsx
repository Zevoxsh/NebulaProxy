import {
  FormControl,
  FormDescription,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from "@/components/ui/form"
import { Input } from "@/components/ui/input"
import { Textarea } from "@/components/ui/textarea"
import { Combobox } from "@/components/ui/combobox"
import { Checkbox } from "@/components/ui/checkbox"
import { Switch } from "@/components/ui/switch"
import { cn } from "@/lib/utils"

/**
 * AdminFormField - Form field wrapper with admin theme
 * Automatically renders the appropriate input type based on the 'type' prop
 *
 * @param {Object} props
 * @param {Object} props.form - react-hook-form form instance
 * @param {string} props.name - Field name
 * @param {string} props.label - Field label
 * @param {string} props.description - Field description (optional)
 * @param {string} props.placeholder - Input placeholder
 * @param {string} props.type - Input type (text, textarea, select, checkbox, switch)
 * @param {Array} props.options - Options for select (array of {label, value})
 */
export function AdminFormField({
  form,
  name,
  label,
  description,
  placeholder,
  type = "text",
  options = [],
  className,
  ...props
}) {
  return (
    <FormField
      control={form.control}
      name={name}
      render={({ field }) => (
        <FormItem className={cn("space-y-2", className)}>
          {label && (
            <FormLabel className="text-admin-text font-medium">
              {label}
            </FormLabel>
          )}
          <FormControl>
            {type === "textarea" ? (
              <Textarea
                placeholder={placeholder}
                className="bg-admin-bg border-admin-border text-admin-text placeholder:text-admin-text-subtle focus:border-admin-primary focus:ring-admin-primary"
                {...field}
                {...props}
              />
            ) : type === "select" ? (
              <Combobox
                value={field.value ?? ""}
                onValueChange={field.onChange}
                options={options}
                placeholder={placeholder || "Select option..."}
                searchPlaceholder="Search..."
                emptyText="No option found."
                triggerClassName="h-10 bg-admin-bg border-admin-border text-admin-text focus:border-admin-primary focus:ring-admin-primary"
              />
            ) : type === "checkbox" ? (
              <div className="flex items-center space-x-2">
                <Checkbox
                  checked={field.value}
                  onCheckedChange={field.onChange}
                  className="border-admin-border data-[state=checked]:bg-admin-primary data-[state=checked]:border-admin-primary"
                  {...props}
                />
                {label && (
                  <label className="text-sm text-admin-text cursor-pointer">
                    {label}
                  </label>
                )}
              </div>
            ) : type === "switch" ? (
              <div className="flex items-center space-x-2">
                <Switch
                  checked={field.value}
                  onCheckedChange={field.onChange}
                  className="data-[state=checked]:bg-admin-primary"
                  {...props}
                />
                {label && (
                  <label className="text-sm text-admin-text cursor-pointer">
                    {label}
                  </label>
                )}
              </div>
            ) : (
              <Input
                type={type}
                placeholder={placeholder}
                className="bg-admin-bg border-admin-border text-admin-text placeholder:text-admin-text-subtle focus:border-admin-primary focus:ring-admin-primary"
                {...field}
                {...props}
              />
            )}
          </FormControl>
          {description && (
            <FormDescription className="text-admin-text-muted text-xs">
              {description}
            </FormDescription>
          )}
          <FormMessage className="text-admin-danger text-xs" />
        </FormItem>
      )}
    />
  )
}
