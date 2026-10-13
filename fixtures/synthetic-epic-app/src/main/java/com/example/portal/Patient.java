package com.example.portal;

import javax.persistence.Entity;
import javax.persistence.Id;
import javax.persistence.Table;

@Entity
@Table(name = "patients")
public class Patient {
    @Id private Long id;
}
