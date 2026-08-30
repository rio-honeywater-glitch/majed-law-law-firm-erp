import React from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";

const mocks = vi.hoisted(() => ({
  useAuth: vi.fn(),
  useToast: vi.fn(),
  toast: vi.fn(),
}));

vi.mock("@/lib/auth", () => ({
  useAuth: mocks.useAuth,
}));

vi.mock("@/hooks/use-toast", () => ({
  useToast: mocks.useToast,
}));

import ClientReportModal from "./ClientReportModal";

const reportBlocks = [{
  id: "summary",
  type: "text" as const,
  title: "الملخص",
  content: "محتوى التقرير المتطابق",
}];

const firstUser = {
  id: 101,
  tenantId: 7,
  email: "first@example.com",
  name: "المستخدم الأول",
  role: "SYSTEM_MANAGER" as const,
};

const secondUser = {
  id: 202,
  tenantId: 8,
  email: "second@example.com",
  name: "المستخدم الثاني",
  role: "SYSTEM_MANAGER" as const,
};

function jsonResponse(body: unknown, status = 200) {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
  };
}

describe("استقلال محاولات إرسال تقرير العميل بين الحسابات", () => {
  let activeUser = firstUser;

  beforeEach(() => {
    activeUser = firstUser;
    mocks.useAuth.mockImplementation(() => ({ user: activeUser }));
    mocks.useToast.mockReturnValue({ toast: mocks.toast });
    mocks.toast.mockReset();
    localStorage.clear();
  });

  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
    localStorage.clear();
  });

  function renderReportModal() {
    return render(
      <ClientReportModal
        open
        onClose={vi.fn()}
        caseId={42}
        caseNumber="123/ق"
        caseSubject="قضية اختبار"
        clientName="عميل الاختبار"
      />,
    );
  }

  it("يعزل الحسابات ويستعيد محاولة الحساب الأول بعد العودة إليه", async () => {
    const sendBodies: Array<Record<string, unknown>> = [];
    const sendResponses = [
      jsonResponse({ error: "تعذر إرسال التقرير مؤقتاً" }, 503),
      jsonResponse({ ok: true, reportId: 501, sentTo: "client@example.com" }),
      jsonResponse({ ok: true, reportId: 502, sentTo: "client@example.com" }),
    ];
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url.endsWith("/report-template")) {
        return jsonResponse({ blocks: reportBlocks });
      }
      if (url.endsWith("/reports")) {
        return jsonResponse([]);
      }
      if (url.endsWith("/send-report")) {
        sendBodies.push(JSON.parse(String(init?.body)) as Record<string, unknown>);
        return sendResponses.shift() ?? jsonResponse({ error: "طلب غير متوقع" }, 500);
      }
      throw new Error(`Unexpected request: ${url}`);
    });
    vi.stubGlobal("fetch", fetchMock);

    const sendButton = () => screen.getByRole("button", { name: "إرسال إلى بريد العميل" });

    const firstRender = renderReportModal();
    await waitFor(() => expect(sendButton()).not.toBeDisabled());
    fireEvent.click(sendButton());
    await waitFor(() => expect(sendBodies).toHaveLength(1));

    const firstAttemptId = sendBodies[0].sendAttemptId;
    expect(firstAttemptId).toEqual(expect.any(String));
    expect(mocks.toast).toHaveBeenCalledWith({
      variant: "destructive",
      title: "فشل إرسال التقرير",
      description: "تعذر إرسال التقرير مؤقتاً",
    });

    firstRender.unmount();
    activeUser = secondUser;
    const secondRender = renderReportModal();
    await waitFor(() => expect(sendButton()).not.toBeDisabled());
    fireEvent.click(sendButton());
    await waitFor(() => expect(sendBodies).toHaveLength(2));

    const secondAttemptId = sendBodies[1].sendAttemptId;
    expect(secondAttemptId).toEqual(expect.any(String));
    expect(secondAttemptId).not.toBe(firstAttemptId);
    expect(mocks.toast).toHaveBeenCalledWith({
      title: "✅ تم إرسال التقرير إلى client@example.com",
    });
    expect(mocks.toast).not.toHaveBeenCalledWith(
      expect.objectContaining({ description: expect.stringContaining("تعارض") }),
    );

    secondRender.unmount();
    activeUser = firstUser;
    const firstUserAgainRender = renderReportModal();
    await waitFor(() => expect(sendButton()).not.toBeDisabled());
    fireEvent.click(sendButton());
    await waitFor(() => expect(sendBodies).toHaveLength(3));

    expect(sendBodies[2].sendAttemptId).toBe(firstAttemptId);
    expect(sendBodies[2].sendAttemptId).not.toBe(secondAttemptId);
  });
});