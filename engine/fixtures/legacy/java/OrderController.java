package com.example.orders;

import org.springframework.stereotype.Controller;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PostMapping;
import com.example.orders.OrderService;
import java.util.List;

@Controller
public class OrderController {
    @GetMapping("/orders/list")
    public String list(Model model) {
        model.addAttribute("orders", service.all());
        return "orders/list";
    }

    @PostMapping(path = "/orders/save")
    public String save(Order order) {
        jdbc.update("UPDATE customer_orders SET status = ? WHERE id = ?", order.status(), order.id());
        return "redirect:/orders/list";
    }
}
