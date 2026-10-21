CREATE OR REPLACE PACKAGE BODY billing AS
  PROCEDURE post_invoice IS
  BEGIN
    SELECT total INTO v_total FROM INVOICES WHERE id = 1;
    UPDATE LEDGER SET balance = 0;
    CALL audit_log;
  END;
END billing;
