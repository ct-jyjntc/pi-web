/**
 * next/dynamic → React.lazy + Suspense for desktop Vite builds.
 */
import {
  lazy,
  Suspense,
  type ComponentType,
  type ReactNode,
} from "react";

type Loader = () => Promise<ComponentType<any> | { default: ComponentType<any> }>;

type DynamicOptions = {
  loading?: ComponentType;
  ssr?: boolean;
};

export default function dynamic(loader: Loader, options: DynamicOptions = {}) {
  const LazyComp = lazy(async () => {
    const mod = await loader();
    if (mod && typeof mod === "object" && "default" in mod && mod.default) {
      return mod as { default: ComponentType<any> };
    }
    return { default: mod as ComponentType<any> };
  });

  const Fallback = options.loading;

  function DynamicComponent(props: Record<string, unknown>) {
    return (
      <Suspense fallback={Fallback ? <Fallback /> : (null as ReactNode)}>
        <LazyComp {...props} />
      </Suspense>
    );
  }

  DynamicComponent.displayName = "DynamicImport";
  return DynamicComponent;
}
