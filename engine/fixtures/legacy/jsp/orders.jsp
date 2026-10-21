<%@ page language="java" contentType="text/html; charset=UTF-8" %>
<%@ include file="/WEB-INF/jspf/header.jspf" %>
<html>
<body>
<h2>Open orders</h2>
<%
  java.sql.Statement st = conn.createStatement();
  java.sql.ResultSet rs = st.executeQuery("SELECT id, status FROM order_header WHERE status = 'OPEN'");
%>
<jsp:include page="footer.jsp" />
</body>
</html>
