import {
  Banner,
  Button,
  Card,
  Form,
  FormLayout,
  Frame,
  Page,
  Spinner,
  Stack,
  Text,
  TextField,
  TopBar,
} from "@shopify/polaris";
import { useCallback, useEffect, useState, type ReactNode } from "react";
import { useMutation, useQuery, useQueryClient } from "react-query";
import { UNAUTHORIZED_EVENT } from "../platform";
import { fetchJson } from "../utils/fetchJson";
import { ToastProvider } from "./providers/ToastProvider";

interface AccountResponse {
  account: { email: string };
}

const ACCOUNT_KEY = "standaloneAccount";

async function fetchAccount(): Promise<AccountResponse | null> {
  const response = await fetch("/api/standalone/auth/me");
  if (response.status === 401) return null;
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  return (await response.json()) as AccountResponse;
}

/**
 * Khung của chế độ độc lập: chưa đăng nhập thì hiện form đăng nhập/đăng ký,
 * đã đăng nhập thì bọc trang bằng Frame (thanh trên + toast của Polaris).
 */
export function StandaloneShell({ children }: { children: ReactNode }) {
  const queryClient = useQueryClient();
  const account = useQuery([ACCOUNT_KEY], fetchAccount, {
    refetchOnWindowFocus: false,
    retry: false,
  });

  /** Đổi tài khoản thì bỏ dữ liệu của tài khoản cũ đang nằm trong cache. */
  const switchAccount = useCallback(
    (next: AccountResponse | null) => {
      queryClient.removeQueries({ predicate: (query) => query.queryKey[0] !== ACCOUNT_KEY });
      queryClient.setQueryData([ACCOUNT_KEY], next);
    },
    [queryClient]
  );

  useEffect(() => {
    const onUnauthorized = () => switchAccount(null);
    window.addEventListener(UNAUTHORIZED_EVENT, onUnauthorized);
    return () => window.removeEventListener(UNAUTHORIZED_EVENT, onUnauthorized);
  }, [switchAccount]);

  if (account.isLoading) {
    return (
      <div style={{ display: "flex", justifyContent: "center", padding: "80px 16px" }}>
        <Spinner accessibilityLabel="Đang tải" />
      </div>
    );
  }

  if (account.isError) {
    return (
      <Page narrowWidth>
        <Banner
          status="critical"
          title="Không kết nối được tới server"
          action={{ content: "Thử lại", onAction: () => void account.refetch() }}
        />
      </Page>
    );
  }

  if (!account.data) return <SignInPage onSignedIn={switchAccount} />;

  return (
    <SignedInFrame email={account.data.account.email} onSignedOut={() => switchAccount(null)}>
      {children}
    </SignedInFrame>
  );
}

function SignedInFrame({
  email,
  onSignedOut,
  children,
}: {
  email: string;
  onSignedOut(): void;
  children: ReactNode;
}) {
  const [menuOpen, setMenuOpen] = useState(false);

  const signOut = async () => {
    await fetch("/api/standalone/auth/logout", { method: "POST" }).catch(() => undefined);
    onSignedOut();
  };

  const topBar = (
    <TopBar
      userMenu={
        <TopBar.UserMenu
          name={email}
          initials={email.charAt(0).toUpperCase()}
          open={menuOpen}
          onToggle={() => setMenuOpen((open) => !open)}
          actions={[{ items: [{ content: "Đăng xuất", onAction: () => void signOut() }] }]}
        />
      }
    />
  );

  return (
    <Frame topBar={topBar}>
      <ToastProvider>{children}</ToastProvider>
    </Frame>
  );
}

function SignInPage({ onSignedIn }: { onSignedIn(account: AccountResponse): void }) {
  const [mode, setMode] = useState<"login" | "signup">("login");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");

  const submit = useMutation<AccountResponse, Error>(
    () =>
      fetchJson<AccountResponse>(`/api/standalone/auth/${mode}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, password }),
      }),
    { onSuccess: onSignedIn },
  );

  const isSignup = mode === "signup";

  return (
    <div style={{ paddingTop: "48px" }}>
      <Page narrowWidth>
        <Card sectioned>
          <Stack vertical spacing="loose">
            <Stack vertical spacing="extraTight">
              <Text as="h1" variant="headingLg">
                Watermark Studio
              </Text>
              <Text as="p" variant="bodyMd" color="subdued">
                {isSignup
                  ? "Tạo tài khoản để đóng watermark cho ảnh của bạn, không cần cửa hàng Shopify."
                  : "Đăng nhập để tiếp tục. Nếu bạn dùng Shopify, hãy mở app từ trang quản trị Shopify."}
              </Text>
            </Stack>

            {submit.error && <Banner status="critical" title={submit.error.message} />}

            <Form onSubmit={() => submit.mutate()}>
              <FormLayout>
                <TextField
                  label="Email"
                  type="email"
                  value={email}
                  onChange={setEmail}
                  autoComplete="email"
                />
                <TextField
                  label="Mật khẩu"
                  type="password"
                  value={password}
                  onChange={setPassword}
                  autoComplete={isSignup ? "new-password" : "current-password"}
                  helpText={isSignup ? "Tối thiểu 8 ký tự" : undefined}
                />
                <Button primary submit fullWidth loading={submit.isLoading}>
                  {isSignup ? "Tạo tài khoản" : "Đăng nhập"}
                </Button>
              </FormLayout>
            </Form>

            <Stack distribution="center">
              <Button
                plain
                onClick={() => {
                  submit.reset();
                  setMode(isSignup ? "login" : "signup");
                }}
              >
                {isSignup ? "Đã có tài khoản? Đăng nhập" : "Chưa có tài khoản? Đăng ký"}
              </Button>
            </Stack>
          </Stack>
        </Card>
      </Page>
    </div>
  );
}
