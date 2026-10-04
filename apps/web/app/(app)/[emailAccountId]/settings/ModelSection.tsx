"use client";

import Link from "next/link";
import { BarChartIcon, RefreshCwIcon } from "lucide-react";
import { useCallback } from "react";
import {
  type FieldErrors,
  type SubmitHandler,
  type UseFormRegister,
  useForm,
} from "react-hook-form";
import { useDebounceValue } from "usehooks-ts";
import useSWR from "swr";
import { Button } from "@/components/ui/button";
import { toastError, toastSuccess } from "@/components/Toast";
import { Input } from "@/components/Input";
import { zodResolver } from "@hookform/resolvers/zod";
import { LoadingContent } from "@/components/LoadingContent";
import { SettingsSection } from "@/components/SettingsSection";
import {
  saveAiSettingsBody,
  type SaveAiSettingsBody,
} from "@/utils/actions/settings.validation";
import { Select } from "@/components/Select";
import type { OpenAiModelsResponse } from "@/app/api/ai/models/route";
import type { GetLlmModelsResponse } from "@/app/api/user/llm-models/route";
import { normalizeEndpointUrl } from "@/utils/llms/endpoint-url";
import { AlertBasic, AlertError } from "@/components/Alert";
import {
  DEFAULT_PROVIDER,
  Provider,
  providerOptions,
} from "@/utils/llms/config";
import { useUser } from "@/hooks/useUser";
import { useAccount } from "@/providers/EmailAccountProvider";
import { prefixPath } from "@/utils/path";
import { apiPath } from "@/utils/api-path";
import { updateAiSettingsAction } from "@/utils/actions/settings";

export function ModelSection() {
  const { emailAccountId } = useAccount();
  const { data, isLoading, error, mutate } = useUser();

  const { data: dataModels, isLoading: isLoadingModels } =
    useSWR<OpenAiModelsResponse>(
      data?.hasAiApiKey && data.aiProvider === Provider.OPEN_AI
        ? "/api/ai/models"
        : null,
    );

  return (
    <SettingsSection>
      <LoadingContent loading={isLoading || isLoadingModels} error={error}>
        {data && (
          <ModelSectionForm
            aiProvider={data.aiProvider}
            aiModel={data.aiModel}
            aiBaseUrl={data.aiBaseUrl}
            hasAiApiKey={data.hasAiApiKey}
            models={dataModels}
            refetchUser={mutate}
            emailAccountId={emailAccountId}
          />
        )}
      </LoadingContent>
    </SettingsSection>
  );
}

function ModelSectionForm(props: {
  aiProvider: SaveAiSettingsBody["aiProvider"] | null;
  aiModel: SaveAiSettingsBody["aiModel"] | null;
  aiBaseUrl: string | null;
  hasAiApiKey: boolean;
  models?: OpenAiModelsResponse;
  refetchUser: () => void;
  emailAccountId: string;
}) {
  const { refetchUser, emailAccountId } = props;

  const {
    register,
    handleSubmit,
    watch,
    formState: { errors, isSubmitting },
  } = useForm<SaveAiSettingsBody>({
    resolver: zodResolver(saveAiSettingsBody),
    defaultValues: {
      aiProvider: props.aiProvider ?? DEFAULT_PROVIDER,
      aiModel: props.aiModel ?? "",
      aiApiKey: undefined,
      aiBaseUrl: props.aiBaseUrl ?? "",
    },
  });

  const aiProvider = watch("aiProvider");
  const aiApiKey = watch("aiApiKey");
  const hasStoredAiApiKey =
    props.hasAiApiKey && props.aiProvider === aiProvider;
  const hasAnyApiKey = !!aiApiKey || hasStoredAiApiKey;

  const onSubmit: SubmitHandler<SaveAiSettingsBody> = useCallback(
    async (data) => {
      const res = await updateAiSettingsAction(data);

      if (res?.serverError) {
        toastError({
          description: res.serverError,
        });
      } else {
        toastSuccess({
          description:
            "Settings updated! Please check it works on the Assistant page.",
        });
      }

      refetchUser();
    },
    [refetchUser],
  );

  const globalError = (errors as Record<string, { message?: string }>)[""];

  const modelSelectOptions =
    aiProvider === Provider.OPEN_AI && hasAnyApiKey
      ? props.models?.map((model) => ({
          label: model.id,
          value: model.id,
        })) || []
      : [];

  return (
    <form onSubmit={handleSubmit(onSubmit)} className="max-w-sm space-y-4">
      <Select
        label="Provider"
        options={providerOptions}
        {...register("aiProvider")}
        error={errors.aiProvider}
      />

      {aiProvider === Provider.OPENAI_COMPATIBLE && (
        <CustomEndpointFields
          register={register}
          errors={errors}
          baseUrl={watch("aiBaseUrl") ?? ""}
          apiKey={aiApiKey ?? ""}
          hasStoredAiApiKey={hasStoredAiApiKey}
        />
      )}

      {aiProvider !== DEFAULT_PROVIDER &&
        aiProvider !== Provider.OPENAI_COMPATIBLE && (
          <>
            {modelSelectOptions.length ? (
              <Select
                label="Model"
                options={modelSelectOptions}
                {...register("aiModel")}
                error={errors.aiModel}
              />
            ) : (
              <Input
                type="text"
                name="aiModel"
                label="Model"
                registerProps={register("aiModel")}
                error={errors.aiModel}
              />
            )}

            <Input
              type="password"
              name="aiApiKey"
              label="API Key"
              registerProps={register("aiApiKey")}
              error={errors.aiApiKey}
              placeholder={
                hasStoredAiApiKey
                  ? "Leave blank to keep the current key"
                  : undefined
              }
              explainText={
                hasStoredAiApiKey
                  ? "Leave this blank to keep the current API key, or enter a new key to replace it."
                  : undefined
              }
            />
          </>
        )}

      {globalError?.message && (
        <AlertError title="Error saving" description={globalError.message} />
      )}

      {aiProvider === Provider.OPEN_AI &&
        hasAnyApiKey &&
        modelSelectOptions.length === 0 &&
        (hasStoredAiApiKey ? (
          <AlertError
            title="Invalid API Key"
            description="We couldn't validate your API key. Please try again."
          />
        ) : (
          <AlertBasic
            title="API Key"
            description="Click Save to view available models for your API key."
          />
        ))}

      <div className="flex items-center gap-2">
        <Button type="submit" size="sm" loading={isSubmitting}>
          Save
        </Button>
        <Button asChild variant="outline" size="sm">
          <Link href={prefixPath(emailAccountId, "/usage")}>
            <BarChartIcon className="mr-2 size-4" />
            View usage
          </Link>
        </Button>
      </div>
    </form>
  );
}

function CustomEndpointFields({
  register,
  errors,
  baseUrl,
  apiKey,
  hasStoredAiApiKey,
}: {
  register: UseFormRegister<SaveAiSettingsBody>;
  errors: FieldErrors<SaveAiSettingsBody>;
  baseUrl: string;
  apiKey: string;
  hasStoredAiApiKey: boolean;
}) {
  const [debouncedBaseUrl] = useDebounceValue(baseUrl, 600);
  const [debouncedApiKey] = useDebounceValue(apiKey, 600);

  const validBaseUrl = normalizeEndpointUrl(debouncedBaseUrl);
  const isSettling = baseUrl !== debouncedBaseUrl || apiKey !== debouncedApiKey;

  const {
    data: models,
    error,
    isValidating,
    mutate,
  } = useSWR<GetLlmModelsResponse>(
    validBaseUrl ? ["llm-models", validBaseUrl, debouncedApiKey] : null,
    ([, url, key]: [string, string, string]) => fetchEndpointModels(url, key),
    { revalidateOnFocus: false, shouldRetryOnError: false },
  );

  const modelStatus = getModelsStatus({
    hasValidUrl: !!normalizeEndpointUrl(baseUrl),
    loading: isSettling || isValidating,
    unreachable: !!error || models?.status === "unreachable",
    empty: models?.status === "ok" && models.models.length === 0,
  });

  return (
    <>
      <Input
        type="text"
        name="aiBaseUrl"
        label="Endpoint"
        placeholder="http://192.168.0.210:9292/v1"
        registerProps={register("aiBaseUrl")}
        error={errors.aiBaseUrl}
      />

      <Input
        type="password"
        name="aiApiKey"
        label="API key (optional)"
        registerProps={register("aiApiKey")}
        error={errors.aiApiKey}
        placeholder={
          hasStoredAiApiKey ? "Leave blank to keep the current key" : undefined
        }
      />

      <div>
        <Input
          type="text"
          name="aiModel"
          label="Model"
          registerProps={{
            ...register("aiModel"),
            list: "ai-model-suggestions",
            autoComplete: "off",
          }}
          error={errors.aiModel}
        />
        <datalist id="ai-model-suggestions">
          {models?.models.map((id) => (
            <option key={id} value={id} />
          ))}
        </datalist>

        <div className="mt-1 flex items-center gap-2 text-sm text-muted-foreground">
          <span>{modelStatus}</span>
          {validBaseUrl && (
            <Button
              type="button"
              variant="ghost"
              size="icon"
              className="size-6"
              aria-label="Refresh models"
              onClick={() => mutate()}
            >
              <RefreshCwIcon className="size-3.5" />
            </Button>
          )}
        </div>
      </div>
    </>
  );
}

async function fetchEndpointModels(
  baseUrl: string,
  apiKey: string,
): Promise<GetLlmModelsResponse> {
  const response = await fetch(apiPath("/api/user/llm-models"), {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ baseUrl, apiKey: apiKey || undefined }),
  });
  if (!response.ok) throw new Error("Request failed");
  return response.json();
}

function getModelsStatus(state: {
  hasValidUrl: boolean;
  loading: boolean;
  unreachable: boolean;
  empty: boolean;
}) {
  if (!state.hasValidUrl) return null;
  if (state.loading) return "Loading models";
  if (state.unreachable) return "Could not reach the endpoint";
  if (state.empty) return "No models listed; type a model name";
  return null;
}
