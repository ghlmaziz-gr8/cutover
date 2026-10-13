package com.example.portal;

import org.springframework.stereotype.Controller;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.security.access.prepost.PreAuthorize;

// Patient portal: appointments and results
@Controller
public class PortalController {
    @GetMapping("/appointments")
    @PreAuthorize("hasRole('PATIENT')")
    public String appointments() { return "appointments"; }

    @GetMapping("/results")
    @PreAuthorize("hasAnyRole('CLINICIAN','ADMIN')")
    public String results() { return "results"; }
}
