import { useState } from "react";
import {
  QueryClient,
  QueryClientProvider,
  QueryCache,
  MutationCache,
} from "react-query";

export function QueryProvider({ children }) {
  const [client] = useState(
    () =>
      new QueryClient({
        queryCache: new QueryCache(),
        mutationCache: new MutationCache(),
      })
  );

  return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
}
