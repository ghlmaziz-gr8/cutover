package com.example.orders;

import javax.persistence.Entity;
import javax.persistence.Table;

@Entity
@Table(name = "CUSTOMER_MASTER")
public class Customer {
    private Long id;
    private String name;
}
