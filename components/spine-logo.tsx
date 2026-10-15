import Image from "next/image";

export function SpineLogo({ light = false }: { light?: boolean }) {
  return <span className={`spine-logo${light ? " spine-logo-light" : ""}`}><Image src="/spine-wordmark-v1.png" alt="Spine" width={1942} height={809} priority /></span>;
}
