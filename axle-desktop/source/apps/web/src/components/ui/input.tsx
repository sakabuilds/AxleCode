"use client";

import { Input as InputPrimitive } from "@base-ui/react/input";
import type * as React from "react";

import { cn } from "~/lib/utils";

type InputProps = Omit<InputPrimitive.Props & React.RefAttributes<HTMLInputElement>, "size"> & {
  size?: "sm" | "default" | "lg" | number;
  unstyled?: boolean;
  nativeInput?: boolean;
};

function Input({
  className,
  size = "default",
  unstyled = false,
  nativeInput = false,
  ...props
}: InputProps) {
  const inputClassName = cn(
    "h-8.5 w-full min-w-0 rounded-[inherit] px-[calc(--spacing(3)-1px)] leading-8.5 outline-none placeholder:text-muted-foreground/72 sm:h-7.5 sm:leading-7.5 [transition:background-color_5000000s_ease-in-out_0s]",
    size === "sm" && "h-7.5 px-[calc(--spacing(2.5)-1px)] leading-7.5 sm:h-6.5 sm:leading-6.5",
    size === "lg" && "h-9.5 leading-9.5 sm:h-8.5 sm:leading-8.5",
    props.type === "search" &&
      "[&::-webkit-search-cancel-button]:appearance-none [&::-webkit-search-decoration]:appearance-none [&::-webkit-search-results-button]:appearance-none [&::-webkit-search-results-decoration]:appearance-none",
    props.type === "file" &&
      "text-muted-foreground file:me-3 file:bg-transparent file:font-medium file:text-foreground file:text-sm",
  );
  let inputElement: React.ReactElement;

  if (nativeInput) {
    const { style, onValueChange: _onValueChange, ...nativeInputProps } = props;
    const nativeStyle = typeof style === "function" ? undefined : style;

    inputElement = (
      <input
        className={inputClassName}
        data-slot="input"
        size={typeof size === "number" ? size : undefined}
        style={nativeStyle}
        {...(nativeInputProps as React.ComponentProps<"input">)}
      />
    );
  } else {
    inputElement = (
      <InputPrimitive
        className={inputClassName}
        data-slot="input"
        size={typeof size === "number" ? size : undefined}
        {...props}
      />
    );
  }

  return (
    <span
      className={
        cn(
          !unstyled &&
            "relative inline-flex w-full rounded-lg border border-input bg-background text-base text-foreground ring-ring/20 transition-[border-color,box-shadow] duration-150 hover:border-foreground/20 has-focus-visible:border-ring has-focus-visible:ring-2 has-aria-invalid:border-destructive/70 has-focus-visible:has-aria-invalid:ring-destructive/20 has-autofill:bg-foreground/4 has-disabled:cursor-not-allowed has-disabled:opacity-40 motion-reduce:transition-none sm:text-sm dark:has-autofill:bg-foreground/8",
          className,
        ) || undefined
      }
      data-size={size}
      data-slot="input-control"
    >
      {inputElement}
    </span>
  );
}

export { Input, type InputProps };
