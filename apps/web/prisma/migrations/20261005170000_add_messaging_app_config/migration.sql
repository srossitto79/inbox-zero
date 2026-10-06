-- CreateTable
CREATE TABLE "MessagingAppConfig" (
    "id" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "organizationId" TEXT NOT NULL,
    "provider" "MessagingProvider" NOT NULL,
    "clientId" TEXT,
    "clientSecret" TEXT,
    "signingSecret" TEXT,
    "appId" TEXT,
    "appPassword" TEXT,
    "tenantId" TEXT,
    "botToken" TEXT,
    "botSecretToken" TEXT,

    CONSTRAINT "MessagingAppConfig_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "MessagingAppConfig_organizationId_provider_key" ON "MessagingAppConfig"("organizationId", "provider");

-- AddForeignKey
ALTER TABLE "MessagingAppConfig" ADD CONSTRAINT "MessagingAppConfig_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;
