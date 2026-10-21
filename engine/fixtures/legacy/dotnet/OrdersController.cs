using System;
using System.Threading.Tasks;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;

namespace Orders.Web.Controllers
{
    public class OrdersController : Controller
    {
        public async Task<IActionResult> Index()
        {
            return View();
        }

        public IActionResult Details(int id)
        {
            return View();
        }
    }

    public class OrdersContext : DbContext
    {
        public DbSet<OrderHeader> OrderHeaders { get; set; }
    }

    [Table("tblCustomer")]
    public class Customer { }
}
