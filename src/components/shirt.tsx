import { useId } from "react";

export function Shirt({
  primary,
  secondary,
  pattern = "solid",
  label,
  className = "",
}: {
  primary: string;
  secondary: string;
  pattern?: string;
  label: string;
  className?: string;
}) {
  const id = useId().replace(/:/g, "");
  const outline =
    "M64 30 40 41 15 73 42 93 55 76 55 165 145 165 145 76 158 93 185 73 160 41 136 30 Q120 44 100 44 Q80 44 64 30Z";
  return (
    <svg viewBox="0 0 200 190" role="img" aria-label={label} className={`shirt ${className}`}>
      <defs>
        <clipPath id={id}>
          <path d={outline} />
        </clipPath>
      </defs>
      <path d={outline} fill={primary} stroke="#222b2926" strokeWidth="1.2" />
      <g clipPath={`url(#${id})`}>
        {pattern === "stripe" &&
          [61, 89, 117].map((x) => (
            <rect key={x} x={x} y="40" width="13" height="128" fill={secondary} />
          ))}
        {pattern === "panel" && <path d="M18 69H184V88H18Z" fill={secondary} />}
        <path d="M61 31Q100 69 139 31" fill="none" stroke={secondary} strokeWidth="9" />
        <path d="M27 83 43 94M157 94 174 82M56 158H144" stroke={secondary} strokeWidth="4" />
        <path
          d="M59 82V151M141 82V151M68 54 56 75M132 54 144 75"
          stroke="#1c27242b"
          strokeWidth="1.2"
          fill="none"
        />
      </g>
    </svg>
  );
}
