from app.core.security import hash_password, verify_password, create_token, decode_token
from jose import JWTError
import pytest

def test_password_round_trip():
    hashed = hash_password("hunter2")
    assert verify_password("hunter2", hashed) is True
    assert verify_password("wrong", hashed) is False

def test_access_token_round_trip():
    token = create_token("user-uuid-123", "access")
    payload = decode_token(token)
    assert payload["sub"] == "user-uuid-123"
    assert payload["type"] == "access"

def test_refresh_token_round_trip():
    token = create_token("user-uuid-123", "refresh")
    payload = decode_token(token)
    assert payload["type"] == "refresh"

def test_invalid_token_raises():
    with pytest.raises(JWTError):
        decode_token("not.a.valid.token")
