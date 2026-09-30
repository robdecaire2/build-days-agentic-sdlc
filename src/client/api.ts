import type {
  ApiError,
  CreateFeedbackRequest,
  Feedback,
  FeedbackStatus,
  VoteResult,
} from "../shared/contracts.js";

export type FeedbackItem = Feedback & { status?: FeedbackStatus };

export class ApiRequestError extends Error {
  constructor(
    message: string,
    readonly fieldErrors?: Record<string, string[]>,
    readonly httpStatus?: number,
  ) {
    super(message);
  }
}

const genericMessage = "Something went wrong. Try again.";
const rateLimitMessage = "Too many requests. Try again shortly.";

async function request<T>(url: string, options?: RequestInit): Promise<T> {
  let response: Response;
  try {
    response = await fetch(url, {
      ...options,
      headers: {
        "content-type": "application/json",
        ...options?.headers,
      },
    });
  } catch {
    throw new ApiRequestError(genericMessage);
  }
  let body: unknown;
  try {
    body = await response.json();
  } catch {
    body = undefined;
  }
  if (!response.ok) {
    const apiError = body as Partial<ApiError> | undefined;
    const fallback =
      response.status === 429 ? rateLimitMessage : genericMessage;
    throw new ApiRequestError(
      apiError?.error?.message ?? fallback,
      apiError?.error?.fieldErrors,
      response.status,
    );
  }
  if (body === undefined || body === null) {
    throw new ApiRequestError(genericMessage);
  }
  return body as T;
}

export const listFeedback = async (): Promise<FeedbackItem[]> => {
  const result = await request<{ items: FeedbackItem[] }>("/api/feedback");
  return result.items;
};

export const createFeedback = async (
  input: CreateFeedbackRequest,
): Promise<Feedback> => {
  const result = await request<{ feedback: Feedback }>("/api/feedback", {
    method: "POST",
    body: JSON.stringify(input),
  });
  return result.feedback;
};

export const voteForFeedback = (
  id: string,
  clientId: string,
): Promise<VoteResult> =>
  request<VoteResult>(`/api/feedback/${encodeURIComponent(id)}/votes`, {
    method: "POST",
    body: JSON.stringify({ clientId }),
  });

export const updateFeedbackStatus = async (
  id: string,
  status: FeedbackStatus,
): Promise<FeedbackItem> => {
  const result = await request<{ feedback: FeedbackItem }>(
    `/api/feedback/${encodeURIComponent(id)}/status`,
    { method: "PATCH", body: JSON.stringify({ status }) },
  );
  return result.feedback;
};
