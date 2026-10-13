package com.example.fhir;

// Epic FHIR R4 client (synthetic sample). Uses SMART Backend Services with a signed client_assertion.
public class EpicFhirClient {
    private static final String BASE_URL = "https://fhir.example-sandbox.test/api/FHIR/R4";

    public String patientUrl(String id) {
        return BASE_URL + "/Patient/" + id;
    }
}
