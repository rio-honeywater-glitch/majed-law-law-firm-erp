import React from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";

const mocks = vi.hoisted(() => ({
  useGetCase: vi.fn(),
  useAuth: vi.fn(),
  useToast: vi.fn(),
  toast: vi.fn(),
  useParams: vi.fn(),
  useLocation: vi.fn(),
}));

vi.mock("@workspace/api-client-react", () => ({
  useGetCase: mocks.useGetCase,
}));

vi.mock("@/components/layout/AppLayout", () => ({
  AppLayout: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));

vi.mock("@/lib/auth", () => ({
  useAuth: mocks.useAuth,
}));

vi.mock("@/hooks/use-toast", () => ({
  useToast: mocks.useToast,
}));

vi.mock("wouter", () => ({
  useParams: mocks.useParams,
  useLocation: mocks.useLocation,
}));

import ClientReportPage from "./client-report";

const report = {
  id: 17,
  title: "تقرير القضية النهائي",
  reportData: [{
    id: "summary",
    type: "text" as const,
    title: "الملخص",
    content: "محتوى التقرير",
  }],
  createdAt: "2026-08-29T08:00:00.000Z",
  lastSentAt: null,
  lastSentTo: null,
  lastSentBy: null,
};

function jsonResponse(body: unknown, status = 200) {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
  };
}

function setupPage(deleteResponse = jsonResponse({ ok: true })) {
  const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    if (init?.method === "DELETE") return deleteResponse;
    if (url.endsWith("/report-template")) return jsonResponse({ blocks: report.reportData });
    if (url.endsWith("/reports")) return jsonResponse([report]);
    throw new Error(`Unexpected request: ${url}`);
  });

  vi.stubGlobal("fetch", fetchMock);
  render(<ClientReportPage />);
  return fetchMock;
}

async function openSavedReportDeleteDialog() {
  const savedReportsButton = screen.getByRole("button", { name: /المحفوظة/ });
  await waitFor(() => {
    expect(savedReportsButton).toHaveTextContent("1");
  });

  fireEvent.click(savedReportsButton);

  await waitFor(() => {
    expect(screen.getByTestId(`text-saved-report-title-${report.id}`)).toHaveTextContent(report.title);
  });
  const deleteButton = await screen.findByTestId(`button-delete-saved-report-${report.id}`);
  fireEvent.click(deleteButton);

  const dialog = await screen.findByRole("alertdialog");
  return { dialog, savedReportsButton };
}

describe("حذف التقرير المحفوظ من صفحة تقرير العميل", () => {
  beforeEach(() => {
    mocks.useGetCase.mockReturnValue({
      data: { caseNumber: "123/ق", subject: "قضية اختبار" },
      isLoading: false,
    });
    mocks.useAuth.mockReturnValue({ user: null });
    mocks.useParams.mockReturnValue({ id: "42" });
    mocks.useLocation.mockReturnValue(["/cases/42/client-report", vi.fn()]);
    mocks.useToast.mockReturnValue({ toast: mocks.toast });
  });

  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
  });

  it("يعرض اسم التقرير في نافذة التأكيد، والإلغاء لا يغير القائمة أو العداد", async () => {
    const fetchMock = setupPage();
    const { dialog, savedReportsButton } = await openSavedReportDeleteDialog();

    expect(within(dialog).getByTestId("text-confirm-delete-report-title")).toHaveTextContent(
      `"${report.title}"`,
    );

    fireEvent.click(within(dialog).getByTestId("button-cancel-delete-saved-report"));

    await waitFor(() => {
      expect(screen.queryByRole("alertdialog")).not.toBeInTheDocument();
    });
    expect(screen.getByTestId(`text-saved-report-title-${report.id}`)).toBeInTheDocument();
    expect(savedReportsButton).toHaveTextContent("1");
    expect(fetchMock.mock.calls.filter(([, init]) => init?.method === "DELETE")).toHaveLength(0);
  });

  it("يبقي النافذة والتقرير والعداد عند فشل DELETE ويعرض رسالة واضحة", async () => {
    const fetchMock = setupPage(jsonResponse({ error: "تعذر حذف التقرير من الخادم" }, 500));
    const { dialog, savedReportsButton } = await openSavedReportDeleteDialog();

    fireEvent.click(within(dialog).getByTestId("button-confirm-delete-saved-report"));

    await waitFor(() => {
      expect(mocks.toast).toHaveBeenCalledWith({
        variant: "destructive",
        title: "فشل حذف التقرير",
        description: "تعذر حذف التقرير من الخادم",
      });
    });
    expect(screen.getByRole("alertdialog")).toBeInTheDocument();
    expect(screen.getByTestId("text-confirm-delete-report-title")).toHaveTextContent(
      `"${report.title}"`,
    );
    expect(screen.getByTestId(`text-saved-report-title-${report.id}`)).toBeInTheDocument();
    expect(savedReportsButton).toHaveTextContent("1");
    expect(fetchMock.mock.calls.filter(([, init]) => init?.method === "DELETE")).toHaveLength(1);
  });

  it("يزيل التقرير ويحدث العداد بعد نجاح DELETE فقط", async () => {
    const fetchMock = setupPage();
    const { dialog, savedReportsButton } = await openSavedReportDeleteDialog();

    fireEvent.click(within(dialog).getByTestId("button-confirm-delete-saved-report"));

    await waitFor(() => {
      expect(screen.queryByTestId(`text-saved-report-title-${report.id}`)).not.toBeInTheDocument();
      expect(screen.queryByRole("alertdialog")).not.toBeInTheDocument();
    });
    expect(savedReportsButton).toHaveTextContent("0");
    expect(mocks.toast).toHaveBeenCalledWith({ title: "تم حذف التقرير" });
    expect(fetchMock.mock.calls.filter(([, init]) => init?.method === "DELETE")).toHaveLength(1);
  });
});