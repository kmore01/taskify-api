"""Outgoing mail (password reset). Standard library only."""

import logging
import smtplib
from email.message import EmailMessage

from app.core.config import SMTP_FROM, SMTP_HOST, SMTP_PASSWORD, SMTP_PORT, SMTP_USER

logger = logging.getLogger("uvicorn.error")


def send_mail(to: str, subject: str, body: str) -> None:
    if not SMTP_HOST:
        logger.warning("SMTP_HOST is not set; mail for %s not sent:\n%s", to, body)
        return
    message = EmailMessage()
    message["From"], message["To"], message["Subject"] = SMTP_FROM, to, subject
    message.set_content(body)
    try:
        with smtplib.SMTP(SMTP_HOST, SMTP_PORT, timeout=10) as smtp:
            smtp.starttls()
            if SMTP_USER:
                smtp.login(SMTP_USER, SMTP_PASSWORD or "")
            smtp.send_message(message)
    except (OSError, smtplib.SMTPException):
        logger.exception("Could not send mail to %s", to)
