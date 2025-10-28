import { describe, beforeEach, expect, it, vi } from "vitest";
import { act, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { SWRConfig } from "swr";
import { LoginPage } from "../Login";
import { AuthProvider } from "../../contexts/AuthContext";
import { login, ApiError } from "../../lib/api";

vi.mock("react-hot-toast", () => ({
  __esModule: true,
  default: {
    success: vi.fn(),
    error: vi.fn(),
  },
  toast: {
    success: vi.fn(),
    error: vi.fn(),
  },
  Toaster: () => null,
}));

vi.mock("../../lib/api", async () => {
  const actual = await vi.importActual<typeof import("../../lib/api")>("../../lib/api");
  return {
    ...actual,
    login: vi.fn(),
  };
});

const loginMock = login as unknown as ReturnType<typeof vi.fn>;

function renderLogin(initialPath = "/login", state?: unknown) {
  return render(
    <MemoryRouter initialEntries={[{ pathname: initialPath, state }]}>
      <SWRConfig value={{ provider: () => new Map() }}>
        <AuthProvider>
          <Routes>
            <Route path="/login" element={<LoginPage />} />
            <Route path="/admin/*" element={<div>Admin dashboard</div>} />
          </Routes>
        </AuthProvider>
      </SWRConfig>
    </MemoryRouter>,
  );
}

describe("LoginPage", () => {
  beforeEach(() => {
    loginMock.mockReset();
    window.localStorage.clear();
  });

  it("redirects to admin after successful login", async () => {
    loginMock.mockResolvedValueOnce({
      token: "test-token",
      user: { email: "admin", roles: ["admin"] },
    });

    renderLogin();

    const passwordInput = screen.getByLabelText(/password/i);
    await act(async () => {
      await userEvent.type(passwordInput, "supersecret");
      await userEvent.click(screen.getByRole("button", { name: /sign in/i }));
    });

    await waitFor(() => {
      expect(loginMock).toHaveBeenCalledWith({
        email: "admin@explorertoken.dev",
        password: "supersecret",
      });
    });

    await screen.findByText(/admin dashboard/i);
    expect(window.localStorage.getItem("explorer-token-auth")).toBe("test-token");
  });

  it("shows helpful message for invalid credentials", async () => {
    loginMock.mockRejectedValueOnce(new ApiError("Unauthorized", 401, {}));

    renderLogin();

    const passwordInput = screen.getByLabelText(/password/i);
    await act(async () => {
      await userEvent.type(passwordInput, "badpass");
      await userEvent.click(screen.getByRole("button", { name: /sign in/i }));
    });

    await screen.findByText(/invalid email or password/i);
    expect(window.localStorage.getItem("explorer-token-auth")).toBeNull();
  });
});
