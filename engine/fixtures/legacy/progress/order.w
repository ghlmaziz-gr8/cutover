DEFINE VARIABLE cName AS CHARACTER NO-UNDO.
FOR EACH customer NO-LOCK:
  FIND FIRST orders WHERE orders.custnum = customer.custnum NO-LOCK NO-ERROR.
END.
RUN calc.p.
