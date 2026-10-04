import { useEffect } from "react";
import { trackClientConversion } from "@/utils/analytics/client-conversions";
import { apiPath } from "@/utils/api-path";

export const useSignUpEvent = () => {
  useEffect(() => {
    fetch(apiPath("/api/user/complete-registration"), {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({}),
    })
      .then(async (response) => {
        const result = (await response.json()) as {
          clientConversionEligible?: boolean;
        };

        if (result.clientConversionEligible) {
          trackClientConversion({
            name: "registration_completed",
          });
        }
      })
      .catch((error) => {
        console.error("Failed to complete registration:", error);
      });
  }, []);
};
