package com.example.portal;

import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;
import org.springframework.security.access.prepost.PreAuthorize;

@RestController
@RequestMapping("/api/staff")
public class StaffController {
    @PostMapping("/checkin")
    @PreAuthorize("hasRole('FRONTDESK')")
    public String checkin() { return "ok"; }
}
